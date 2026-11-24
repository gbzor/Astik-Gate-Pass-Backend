# Astik Gate Pass API

Base URL (local): `http://localhost:3000/api`

## How the frontend calls it

- Send and receive **JSON**. Add `Content-Type: application/json` on POST/PATCH.
- Login uses an **HttpOnly cookie** (`gp_session`). The browser stores and sends it automatically,
  but only if every `fetch` includes `credentials: 'include'`:
  ```js
  const res = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) showError(data.error.message);
  ```
- The frontend never sees or stores the token. Call `GET /auth/me` on page load to know who is signed in.

## Errors

Every error has the same shape:
```json
{ "error": { "message": "Incorrect email or password." } }
```
Validation errors (400) also list the fields to highlight:
```json
{ "error": { "message": "Please check the highlighted fields.",
             "fields": [{ "field": "email", "message": "Use your school email (@adnu.edu.ph)." }] } }
```

| Code | Meaning |
|---|---|
| 200 / 201 / 204 | OK / Created / OK with no body |
| 400 | Invalid input |
| 401 | Not signed in, or wrong email/password |
| 403 | Signed in but not allowed (wrong role, disabled account) |
| 404 | Not found |
| 409 | Conflict: already exists (email, ID number, plate number, sticker number), the record is in use, or it was already reviewed |
| 429 | Too many requests. Wait and try again |
| 500 | Server error (details are only in the server log) |

---

## Public

### `GET /health`
Checks the server and its database connection.
→ `200 { "status": "ok", "database": "ok", "time": "2026-11-04T..." }`
→ `503 { "status": "degraded", "database": "unreachable", ... }` if the database is down.

## Authentication

Sign-in and sign-up allow **10 failed attempts per 15 minutes** per IP (then `429`).
Successful sign-ins don't count, so students sharing the campus Wi-Fi aren't locked out.

### `POST /auth/register`
Creates a **student** or **faculty** account. Admin accounts can't be created here.
```json
{
  "role": "student",
  "firstName": "Juan",
  "lastName": "Dela Cruz",
  "email": "juan@gbox.adnu.edu.ph",
  "schoolId": "2023-12345",
  "password": "Student-Pass-1!",
  "confirmPassword": "Student-Pass-1!"
}
```
Rules: school email only (`@adnu.edu.ph` or a subdomain), password 8–72 characters with a letter, a number and a symbol.

→ `201 { "user": { ...user }, "message": "Account created. You can now sign in." }`
→ `409` if the email or ID number is already used.

### `POST /auth/login`
Student and faculty login page. Admins are refused here.
```json
{ "email": "juan@gbox.adnu.edu.ph", "password": "Student-Pass-1!" }
```
→ `200 { "user": { ...user } }` and sets the session cookie.

### `POST /auth/admin/login`
Admin login page. Same body and response as `/auth/login`. Only `admin` accounts are accepted.

### `POST /auth/logout`
Signs out: the session token stops working at once (even a copy of it), and the cookie is cleared.
Other devices the user is signed in on stay signed in. → `204`

### `GET /auth/me` 🔒
Returns the signed-in user. → `200 { "user": { ...user } }`, or `401` if not signed in.

### The `user` object
```json
{
  "id": "2f1c...uuid",
  "role": "student",
  "status": "active",
  "firstName": "Juan",
  "lastName": "Dela Cruz",
  "fullName": "Juan Dela Cruz",
  "email": "juan@gbox.adnu.edu.ph",
  "schoolId": "2023-12345",
  "createdAt": "2026-11-04T..."
}
```

---

## Lists: paging, sorting and search

Admin lists (`GET /users`, `GET /vehicles`, `GET /sticker-applications`) accept these query parameters:

| Parameter | Default | Notes |
|---|---|---|
| `page` | `1` | Page number |
| `limit` | `20` | Rows per page, at most `100` |
| `sort` | `createdAt` | See each endpoint for allowed values |
| `order` | `desc` | `asc` or `desc` |
| `q` | none | Search text, up to 100 characters (letters, numbers, spaces, `@ . ' _ -`) |
| `from` | none | Created on or after this day, e.g. `2026-08-01` (campus time, UTC+8) |
| `to` | none | Created on or before this day, e.g. `2026-08-31`. Must not be before `from`; range at most 1830 days |

Every list response includes:
```json
"pagination": { "page": 1, "limit": 20, "total": 57, "totalPages": 3 }
```
Example: `fetch(`${api}/users?role=student&q=${encodeURIComponent(search)}&page=2`, { credentials: 'include' })`

---

## Users

### `PATCH /users/me` 🔒 any signed-in user
Edits your own name. Send one or both fields. Email, ID number, role and status can't be changed here.
```json
{ "firstName": "Juan", "lastName": "Dela Cruz" }
```
→ `200 { "user": { ...user } }`

### `GET /users` 🔒 admin
User records. Filters: `role` (`student`, `faculty`, `admin`), `status` (`active`, `disabled`), `q` (name, email or ID number).
Sort: `createdAt`, `lastName`, `firstName`, `email`, `schoolId`.
```
GET /users?role=faculty&status=active&q=mendoza&sort=lastName&order=asc
```
→ `200`
```json
{
  "users": [
    { "id": "…", "role": "faculty", "status": "active", "firstName": "Carla", "lastName": "Mendoza",
      "email": "cmendoza@adnu.edu.ph", "schoolId": "EMP-0100", "createdAt": "…", "vehicleCount": 2 }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

### `GET /users/:id` 🔒 admin
One user with their vehicles. → `200 { "user": { ...user }, "vehicles": [ ...vehicle ] }`, or `404`.

### `PATCH /users/:id/status` 🔒 admin
Enables or disables a student or faculty account. A disabled user is signed out on their next request
and can't sign in again until re-enabled.
```json
{ "status": "disabled" }
```
→ `200 { "user": { ...user } }`
→ `400` for your own account, `403` for another admin account, `404` if the user doesn't exist.

---

## Vehicles

### `POST /vehicles` 🔒 student, faculty
Registers a vehicle to the signed-in user (the owner always comes from the session).
```json
{ "plateNumber": "ABC 1234", "type": "car", "make": "Toyota", "model": "Vios", "color": "White" }
```
- `type`: `car`, `motorcycle`, `tricycle`, `van` or `other`.
- `make`, `model`, `color` are optional.
- The plate is saved in capitals with single spaces (`abc  1234` → `ABC 1234`). 3–15 letters, numbers, spaces or hyphens.
- Up to 5 vehicles per user.

→ `201 { "vehicle": { ...vehicle } }`
→ `409` if the plate is already registered, or the user already has 5 vehicles.

### `GET /vehicles/mine` 🔒 student, faculty
Your own vehicles, newest first. → `200 { "vehicles": [ ...vehicle ] }`

### `GET /vehicles` 🔒 admin
All vehicles, with owner details. Filters: `type`, `ownerRole` (`student`, `faculty`), `ownerId`,
`isActive` (`true` or `false`), `q` (plate, make, model, color, owner name or ID number). Sort: `createdAt`, `plateNumber`, `type`, `make`.
→ `200 { "vehicles": [ ...vehicle with owner ], "pagination": { … } }`

### `GET /vehicles/:id` 🔒 owner or admin
→ `200 { "vehicle": { ...vehicle } }`. Admins also get `owner`.
→ `404` if it doesn't exist **or belongs to someone else** (so vehicle IDs can't be guessed).

### `PATCH /vehicles/:id` 🔒 owner or admin
Send only the fields that change. `null` or `""` clears `make`, `model` or `color`.
```json
{ "color": "Pearl White" }
```
→ `200 { "vehicle": { ...vehicle } }`
→ `409` if the new plate is taken, or the vehicle already has a sticker application (its plate is then locked).

### `DELETE /vehicles/:id` 🔒 owner or admin
→ `204`. → `409` if the vehicle has sticker or parking records (they're kept for the records).

### The `vehicle` object
```json
{
  "id": "9b06…uuid",
  "ownerId": "4cc0…uuid",
  "plateNumber": "ABC 1234",
  "type": "car",
  "make": "Toyota",
  "model": "Vios",
  "color": "White",
  "isActive": true,
  "createdAt": "2026-11-09T…",
  "updatedAt": "2026-11-09T…",
  "owner": { "id": "…", "firstName": "Ana", "lastName": "Reyes", "fullName": "Ana Reyes",
             "schoolId": "2023-00001", "email": "ana@gbox.adnu.edu.ph", "role": "student" }
}
```
`owner` is only included in admin views. `isActive: false` means the vehicle is deactivated: it stays
in the records but can't get a campus sticker (hide or disable its "Apply for sticker" button).

---

## Campus sticker applications

A student or faculty member applies for a sticker for one of their vehicles. An admin then approves it
(giving a sticker number and an expiry date) or rejects it (giving a reason).

| Status | Meaning | Can change to |
|---|---|---|
| `pending` | Waiting for an admin | `approved` or `rejected` |
| `approved` | Sticker issued (`stickerNumber`, `expiresAt` are set) | (final) |
| `rejected` | Refused (`rejectionReason` is set) | (final); the vehicle can be applied for again |

A vehicle can have only **one** `pending` or `approved` application at a time.

### `POST /sticker-applications` 🔒 student, faculty
Applies for a sticker for one of **your own active** vehicles. The applicant always comes from the session.
```json
{ "vehicleId": "9b06…uuid" }
```
→ `201 { "application": { ...application } }` with `status: "pending"`
→ `404` if the vehicle doesn't exist **or isn't yours**.
→ `409` if the vehicle already has a pending or approved application, or is deactivated.

### `GET /sticker-applications/mine` 🔒 student, faculty
Your own applications, newest first (up to 100). Optional filter: `status` (`pending`, `approved`, `rejected`).
```
GET /sticker-applications/mine?status=pending
```
→ `200 { "applications": [ ...application ] }`

### `GET /sticker-applications` 🔒 admin
Every application, with applicant details. Paging, sorting and search work like the other admin lists.
Filters: `status`, `applicantRole` (`student`, `faculty`), `applicantId`, `vehicleId`,
`q` (plate number, sticker number, applicant name or ID number).
Sort: `createdAt`, `reviewedAt`, `status`, `plateNumber`, `stickerNumber`, `expiresAt`.
```
GET /sticker-applications?status=pending&sort=createdAt&order=asc
```
→ `200 { "applications": [ ...application with applicant ], "pagination": { … } }`

### `GET /sticker-applications/:id` 🔒 applicant or admin
→ `200 { "application": { ...application } }`. Admins also get `applicant` and `reviewedBy`.
→ `404` if it doesn't exist **or belongs to someone else**.

### `PATCH /sticker-applications/:id/approve` 🔒 admin
Approves a **pending** application and issues the sticker.
```json
{ "stickerNumber": "2026-0001", "expiresAt": "2027-06-30" }
```
- `stickerNumber`: 1–20 letters, numbers or hyphens, saved in capitals. Must be unique.
- `expiresAt`: a date (`YYYY-MM-DD`, from `<input type="date">`), meaning the **end of that day, Philippine time**,
  or a full ISO date-time with a time zone (`2027-06-30T17:00:00+08:00`). Must be in the future and at most 730 days away.

→ `200 { "application": { ...application } }` with `status: "approved"`
→ `409` if it was already approved or rejected, the sticker number is taken, or the vehicle was deactivated.

### `PATCH /sticker-applications/:id/reject` 🔒 admin
Rejects a **pending** application. The reason is shown to the applicant, so write it for them.
```json
{ "reason": "The OR/CR photo is unreadable. Please apply again." }
```
- `reason`: 3–500 characters. Line breaks are allowed.

→ `200 { "application": { ...application } }` with `status: "rejected"`
→ `409` if it was already approved or rejected.

### The `application` object
```json
{
  "id": "5d2e…uuid",
  "status": "approved",
  "vehicleId": "9b06…uuid",
  "applicantId": "4cc0…uuid",
  "stickerNumber": "2026-0001",
  "expiresAt": "2027-06-30T15:59:59.999Z",
  "rejectionReason": null,
  "reviewedAt": "2026-11-15T…",
  "createdAt": "2026-11-15T…",
  "updatedAt": "2026-11-15T…",
  "vehicle": { "id": "9b06…uuid", "plateNumber": "ABC 1234", "type": "car", "make": "Toyota",
               "model": "Vios", "color": "White", "isActive": true },
  "applicant": { "id": "…", "firstName": "Ana", "lastName": "Reyes", "fullName": "Ana Reyes",
                 "schoolId": "2023-00001", "email": "ana@gbox.adnu.edu.ph", "role": "student" },
  "reviewedBy": { "id": "…", "fullName": "System Admin" }
}
```
- `applicant` and `reviewedBy` are only included in admin views.
- `stickerNumber` and `expiresAt` are `null` unless approved; `rejectionReason` is `null` unless rejected;
  `reviewedAt` is `null` while pending. Dates are in UTC: show them with
  `new Date(expiresAt).toLocaleDateString('en-PH')`.
- Show `rejectionReason` as **text** (`textContent`), never as HTML.

---

## Admin dashboard

Both routes are admin only (`401` signed out, `403` for students and faculty).
The record lists themselves are `GET /users`, `GET /vehicles` and `GET /sticker-applications` above.

### `GET /admin/dashboard` 🔒 admin
Every count the dashboard cards need, in one call. Every key is always present (zero if there are no rows).
→ `200`
```json
{
  "stats": {
    "users": {
      "total": 152, "newRecently": 9,
      "byRole": { "student": 120, "faculty": 31, "admin": 1 },
      "byStatus": { "active": 150, "disabled": 2 }
    },
    "vehicles": {
      "total": 140, "active": 136, "deactivated": 4, "newRecently": 6,
      "byType": { "car": 90, "motorcycle": 45, "tricycle": 0, "van": 4, "other": 1 }
    },
    "stickerApplications": {
      "total": 130, "byStatus": { "pending": 12, "approved": 110, "rejected": 8 },
      "validStickers": 104, "expiringSoon": 7, "expiredStickers": 6
    },
    "parking": { "activeAreas": 3, "totalCapacity": 250, "currentlyParked": 87, "availableSlots": 163 },
    "settings": { "newWithinDays": 7, "expiringWithinDays": 30 },
    "generatedAt": "2026-11-24T03:15:00.000Z"
  }
}
```
- `newRecently`: created in the last `settings.newWithinDays` days.
- `validStickers`: approved and not yet expired. `expiringSoon`: valid, but runs out within
  `settings.expiringWithinDays` days. `expiredStickers`: approved, but the expiry date has passed.

### `GET /admin/activities` 🔒 admin
Recent activity feed, newest first. Filters: `type`, `from`, `to`. Paging: `page`, `limit` (as in other lists).

| `type` | What happened | `actor` is | `recordId` is |
|---|---|---|---|
| `user_registered` | A student or faculty member signed up | that user | the user |
| `vehicle_registered` | A vehicle was added | the owner | the vehicle |
| `sticker_submitted` | A sticker application was sent | the applicant | the application |
| `sticker_approved` | An admin approved an application | the admin | the application |
| `sticker_rejected` | An admin rejected an application | the admin | the application |

```
GET /admin/activities?type=sticker_approved&from=2026-11-01&page=1&limit=10
```
→ `200`
```json
{
  "activities": [
    {
      "id": "sticker_approved:7c1e…", "type": "sticker_approved", "occurredAt": "2026-11-24T02:10:00.000Z",
      "recordId": "7c1e…",
      "actor": { "id": "…", "fullName": "Admin User", "role": "admin" },
      "applicant": { "id": "…", "fullName": "Ana Reyes" },
      "plateNumber": "ANA 001", "stickerNumber": "2026-0001"
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 1, "totalPages": 1 }
}
```
- `applicant` is only filled for `sticker_approved` / `sticker_rejected`; otherwise `null`.
  `plateNumber` is `null` for `user_registered`; `stickerNumber` is only set when approved.
- Use `id` as the list key. Show names and plates as **text** (`textContent`), never as HTML.
- The feed is built from each record's own dates, so profile edits and vehicle edits are not listed.

---

## Roles (for future endpoints)

| Role | How it's created | Login page |
|---|---|---|
| `student` | Sign-up | `/auth/login` |
| `faculty` | Sign-up | `/auth/login` |
| `admin` | `SEED_ADMIN_*` in `.env` | `/auth/admin/login` |

Protected routes use `requireAuth`, plus `requireRole('admin')` (or `'student'`, `'faculty'`) where needed.
