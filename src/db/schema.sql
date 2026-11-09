-- Astik Gate Pass: schema with relationships + constraints (Postgres 13+).
-- Tables are created in dependency order. Safe to re-run on a FRESH database.
-- If an older version of this file was already run, run reset.sql first
-- (CREATE TABLE IF NOT EXISTS silently skips tables that already exist).

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. USERS ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role            VARCHAR(10)  NOT NULL CHECK (role IN ('student', 'faculty', 'admin')),
  status          VARCHAR(10)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  first_name      VARCHAR(60)  NOT NULL CHECK (btrim(first_name) <> ''),
  last_name       VARCHAR(60)  NOT NULL CHECK (btrim(last_name) <> ''),
  email           VARCHAR(254) NOT NULL UNIQUE,
  school_id       VARCHAR(20)  NOT NULL UNIQUE,
  password_hash   TEXT         NOT NULL,
  -- Agreed with the SMS developer: +639XXXXXXXXX (E.164, PH mobile). Nullable.
  contact_number  VARCHAR(13)  CHECK (contact_number ~ '^\+639[0-9]{9}$'),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase     CHECK (email = lower(email)),
  CONSTRAINT users_email_format        CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT users_school_id_uppercase CHECK (school_id = upper(school_id)),
  CONSTRAINT users_school_id_not_blank CHECK (btrim(school_id) <> ''),
  -- Lets other tables prove "this user really is an admin" (see admin_accounts).
  CONSTRAINT users_id_role_key UNIQUE (id, role)
);

-- 2. ADMIN ACCOUNTS ---------------------------------------------------------
-- Extra details for admins. Login stays in users (role = 'admin').
CREATE TABLE IF NOT EXISTS admin_accounts (
  user_id     UUID PRIMARY KEY,
  role        VARCHAR(10) NOT NULL DEFAULT 'admin' CHECK (role = 'admin'),
  position    VARCHAR(80),
  is_super    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_by  UUID REFERENCES admin_accounts(user_id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Only a users row whose role is 'admin' can be an admin account.
  CONSTRAINT admin_accounts_user_fk
    FOREIGN KEY (user_id, role) REFERENCES users(id, role) ON DELETE CASCADE
);

-- 3. VEHICLES  (users 1 --- * vehicles) -------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plate_number  VARCHAR(15) NOT NULL UNIQUE,
  type          VARCHAR(15) NOT NULL CHECK (type IN ('car', 'motorcycle', 'tricycle', 'van', 'other')),
  make          VARCHAR(40),
  model         VARCHAR(40),
  color         VARCHAR(30),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vehicles_plate_uppercase CHECK (plate_number = upper(plate_number)),
  CONSTRAINT vehicles_plate_format    CHECK (plate_number ~ '^[A-Z0-9 -]{3,15}$'),
  -- Lets child tables prove "this vehicle belongs to this user".
  CONSTRAINT vehicles_id_owner_key UNIQUE (id, owner_id)
);
CREATE INDEX IF NOT EXISTS idx_vehicles_owner ON vehicles(owner_id);

-- 4. PARKING AREAS ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS parking_areas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(80)  NOT NULL CHECK (btrim(name) <> ''),
  latitude    NUMERIC(9,6) NOT NULL CHECK (latitude  BETWEEN -90  AND 90),
  longitude   NUMERIC(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  capacity    INTEGER      NOT NULL CHECK (capacity > 0),
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- Case-insensitive unique name ("Gate A" and "gate a" are the same area).
CREATE UNIQUE INDEX IF NOT EXISTS uq_parking_areas_name ON parking_areas(lower(name));

-- 5. CAMPUS STICKERS  (vehicles 1 --- * stickers, approved by admin_accounts) -
CREATE TABLE IF NOT EXISTS campus_stickers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id        UUID NOT NULL,
  applicant_id      UUID NOT NULL,
  status            VARCHAR(10) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
  sticker_number    VARCHAR(20) UNIQUE,
  expires_at        TIMESTAMPTZ,
  reviewed_by       UUID REFERENCES admin_accounts(user_id) ON DELETE RESTRICT,
  reviewed_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The applicant must be the vehicle's actual owner.
  CONSTRAINT stickers_vehicle_owner_fk
    FOREIGN KEY (vehicle_id, applicant_id) REFERENCES vehicles(id, owner_id) ON DELETE RESTRICT,
  -- Pending = nobody reviewed it yet; approved/rejected = an admin did.
  CONSTRAINT stickers_review_matches_status CHECK (
    (status = 'pending'  AND reviewed_by IS NULL     AND reviewed_at IS NULL) OR
    (status <> 'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT stickers_approved_complete CHECK (
    status <> 'approved' OR (sticker_number IS NOT NULL AND expires_at IS NOT NULL)
  ),
  CONSTRAINT stickers_rejected_has_reason CHECK (
    status <> 'rejected' OR btrim(coalesce(rejection_reason, '')) <> ''
  ),
  CONSTRAINT stickers_number_not_blank CHECK (sticker_number IS NULL OR btrim(sticker_number) <> ''),
  CONSTRAINT stickers_expiry_after_creation CHECK (expires_at IS NULL OR expires_at > created_at),
  -- Lets parking_records prove "this sticker belongs to this vehicle".
  CONSTRAINT stickers_id_vehicle_key UNIQUE (id, vehicle_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stickers_one_open_per_vehicle
  ON campus_stickers(vehicle_id) WHERE status IN ('pending', 'approved');
CREATE INDEX IF NOT EXISTS idx_stickers_applicant ON campus_stickers(applicant_id);
CREATE INDEX IF NOT EXISTS idx_stickers_status    ON campus_stickers(status);
CREATE INDEX IF NOT EXISTS idx_stickers_reviewer  ON campus_stickers(reviewed_by);

-- 6. PARKING RECORDS  (-> users, vehicles, parking_areas, stickers) ----------
-- exited_at IS NULL means the vehicle is still parked.
CREATE TABLE IF NOT EXISTS parking_records (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  vehicle_id       UUID NOT NULL,
  parking_area_id  UUID NOT NULL REFERENCES parking_areas(id) ON DELETE RESTRICT,
  sticker_id       UUID,
  entered_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  exited_at        TIMESTAMPTZ,
  -- The user on the record must own the vehicle on the record.
  CONSTRAINT records_vehicle_owner_fk
    FOREIGN KEY (vehicle_id, user_id) REFERENCES vehicles(id, owner_id) ON DELETE RESTRICT,
  -- A sticker (if any) must belong to that same vehicle. NULL sticker_id skips the check.
  CONSTRAINT records_sticker_vehicle_fk
    FOREIGN KEY (sticker_id, vehicle_id) REFERENCES campus_stickers(id, vehicle_id) ON DELETE RESTRICT,
  CONSTRAINT records_exit_after_entry CHECK (exited_at IS NULL OR exited_at >= entered_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_records_one_open_per_vehicle
  ON parking_records(vehicle_id) WHERE exited_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_records_area_open
  ON parking_records(parking_area_id) WHERE exited_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_records_user    ON parking_records(user_id);
CREATE INDEX IF NOT EXISTS idx_records_vehicle ON parking_records(vehicle_id);

-- updated_at triggers -------------------------------------------------------
DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_vehicles_updated ON vehicles;
CREATE TRIGGER trg_vehicles_updated BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_parking_areas_updated ON parking_areas;
CREATE TRIGGER trg_parking_areas_updated BEFORE UPDATE ON parking_areas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_stickers_updated ON campus_stickers;
CREATE TRIGGER trg_stickers_updated BEFORE UPDATE ON campus_stickers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
