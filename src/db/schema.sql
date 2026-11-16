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
  -- FALSE = deactivated: kept for sticker/parking history but no longer usable.
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vehicles_plate_uppercase CHECK (plate_number = upper(plate_number)),
  CONSTRAINT vehicles_plate_format    CHECK (plate_number ~ '^[A-Z0-9 -]{3,15}$'),
  -- Lets child tables prove "this vehicle belongs to this user".
  CONSTRAINT vehicles_id_owner_key UNIQUE (id, owner_id)
);
-- For databases created before is_active existed (CREATE TABLE above skips existing tables).
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
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
                    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
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

-- 5b. STICKER LIFECYCLE: expiry, history, automatic numbering ---------------
-- Status flow:  pending -> approved -> expired      pending -> rejected
-- 'expired' is a real status (set by expire_stickers() or automatically, see below), so the
-- partial index above, which only covers pending/approved, stops blocking the vehicle.

-- Databases created before 'expired' existed still have the old 3-value CHECK; widen it once.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'campus_stickers_status_check'
                AND pg_get_constraintdef(oid) NOT LIKE '%expired%') THEN
    ALTER TABLE campus_stickers DROP CONSTRAINT campus_stickers_status_check;
    ALTER TABLE campus_stickers ADD CONSTRAINT campus_stickers_status_check
      CHECK (status IN ('pending', 'approved', 'rejected', 'expired'));
  END IF;
END $$;

-- Audit trail of every status change. Insert-only: rows are never changed or deleted.
-- changed_by is NULL when nobody in particular did it (applicant submitting, automatic expiry).
CREATE TABLE IF NOT EXISTS sticker_application_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID        NOT NULL REFERENCES campus_stickers(id) ON DELETE RESTRICT,
  from_status     VARCHAR(10) CHECK (from_status IN ('pending', 'approved', 'rejected', 'expired')),
  to_status       VARCHAR(10) NOT NULL CHECK (to_status IN ('pending', 'approved', 'rejected', 'expired')),
  changed_by      UUID REFERENCES admin_accounts(user_id) ON DELETE RESTRICT,
  reason          TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sticker_history_application
  ON sticker_application_history(application_id, changed_at);

CREATE OR REPLACE FUNCTION forbid_history_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'sticker_application_history is insert-only';
END;
$$ LANGUAGE plpgsql;

-- One counter row per year. Taking the row lock inside next_sticker_number() makes
-- concurrent approvals queue up, so two of them can never receive the same number.
CREATE TABLE IF NOT EXISTS sticker_number_counters (
  year         INTEGER PRIMARY KEY CHECK (year BETWEEN 2000 AND 9999),
  last_number  INTEGER NOT NULL CHECK (last_number >= 0)
);

-- Returns the next number like '2026-0001' (year restarts the count). The year is the
-- campus year (Asia/Manila). Numbers already used by hand-typed stickers are skipped.
CREATE OR REPLACE FUNCTION next_sticker_number(p_year INTEGER DEFAULT NULL) RETURNS TEXT AS $$
DECLARE
  y INTEGER := COALESCE(p_year, extract(year FROM (now() AT TIME ZONE 'Asia/Manila'))::INTEGER);
  n INTEGER;
  candidate TEXT;
BEGIN
  LOOP
    INSERT INTO sticker_number_counters (year, last_number) VALUES (y, 1)
    ON CONFLICT (year) DO UPDATE SET last_number = sticker_number_counters.last_number + 1
    RETURNING last_number INTO n;
    -- lpad would cut a 5-digit number short, so only pad below 10000.
    candidate := y::TEXT || '-' || CASE WHEN n < 10000 THEN lpad(n::TEXT, 4, '0') ELSE n::TEXT END;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM campus_stickers WHERE sticker_number = candidate);
  END LOOP;
  RETURN candidate;
END;
$$ LANGUAGE plpgsql;

-- Turns every APPROVED sticker whose expires_at has passed into 'expired'. Safe to run any
-- time, as often as you like; returns how many it changed. Run it from a scheduled job
-- (for example at server start and hourly): SELECT expire_stickers();
CREATE OR REPLACE FUNCTION expire_stickers() RETURNS INTEGER AS $$
DECLARE
  changed INTEGER;
BEGIN
  UPDATE campus_stickers SET status = 'expired'
   WHERE status = 'approved' AND expires_at <= now();
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$ LANGUAGE plpgsql;

-- Before a NEW application is saved, expire this vehicle's lapsed sticker. This is what lets
-- the owner reapply right away even if the scheduled job hasn't run yet.
CREATE OR REPLACE FUNCTION expire_vehicle_stickers_before_insert() RETURNS trigger AS $$
BEGIN
  UPDATE campus_stickers SET status = 'expired'
   WHERE vehicle_id = NEW.vehicle_id AND status = 'approved' AND expires_at <= now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Approving without a number (sticker_number NULL) assigns the next one automatically.
CREATE OR REPLACE FUNCTION assign_sticker_number() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'approved' AND NEW.sticker_number IS NULL THEN
    NEW.sticker_number := next_sticker_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Writes the history row for every new application and every status change.
CREATE OR REPLACE FUNCTION log_sticker_status_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO sticker_application_history (application_id, from_status, to_status)
    VALUES (NEW.id, NULL, NEW.status);
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO sticker_application_history (application_id, from_status, to_status, changed_by, reason)
    VALUES (
      NEW.id, OLD.status, NEW.status,
      CASE WHEN NEW.status IN ('approved', 'rejected') THEN NEW.reviewed_by END,
      CASE WHEN NEW.status = 'rejected' THEN NEW.rejection_reason END
    );
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stickers_expire_before_insert ON campus_stickers;
CREATE TRIGGER trg_stickers_expire_before_insert BEFORE INSERT ON campus_stickers
  FOR EACH ROW EXECUTE FUNCTION expire_vehicle_stickers_before_insert();
DROP TRIGGER IF EXISTS trg_stickers_assign_number ON campus_stickers;
CREATE TRIGGER trg_stickers_assign_number BEFORE UPDATE ON campus_stickers
  FOR EACH ROW EXECUTE FUNCTION assign_sticker_number();
DROP TRIGGER IF EXISTS trg_stickers_log_insert ON campus_stickers;
CREATE TRIGGER trg_stickers_log_insert AFTER INSERT ON campus_stickers
  FOR EACH ROW EXECUTE FUNCTION log_sticker_status_change();
DROP TRIGGER IF EXISTS trg_stickers_log_update ON campus_stickers;
CREATE TRIGGER trg_stickers_log_update AFTER UPDATE OF status ON campus_stickers
  FOR EACH ROW EXECUTE FUNCTION log_sticker_status_change();
DROP TRIGGER IF EXISTS trg_sticker_history_insert_only ON sticker_application_history;
CREATE TRIGGER trg_sticker_history_insert_only BEFORE UPDATE OR DELETE ON sticker_application_history
  FOR EACH ROW EXECUTE FUNCTION forbid_history_changes();

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
