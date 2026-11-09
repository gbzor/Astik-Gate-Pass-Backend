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
| 409 | Conflict: already exists (email, ID number, plate number), or the record is in use |
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
Clears the session cookie. → `204`

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

Admin lists (`GET /users`, `GET /vehicles`) accept these query parameters:

| Parameter | Default | Notes |
|---|---|---|
| `page` | `1` | Page number |
| `limit` | `20` | Rows per page, at most `100` |
| `sort` | `createdAt` | See each endpoint for allowed values |
| `order` | `desc` | `asc` or `desc` |
| `q` | none | Search text, up to 100 characters (letters, numbers, spaces, `@ . ' _ -`) |

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
`q` (plate, make, model, color, owner name or ID number). Sort: `createdAt`, `plateNumber`, `type`, `make`.
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
  "createdAt": "2026-11-09T…",
  "updatedAt": "2026-11-09T…",
  "owner": { "id": "…", "firstName": "Ana", "lastName": "Reyes", "fullName": "Ana Reyes",
             "schoolId": "2023-00001", "email": "ana@gbox.adnu.edu.ph", "role": "student" }
}
```
`owner` is only included in admin views.

---

## Roles (for future endpoints)

| Role | How it's created | Login page |
|---|---|---|
| `student` | Sign-up | `/auth/login` |
| `faculty` | Sign-up | `/auth/login` |
| `admin` | `SEED_ADMIN_*` in `.env` | `/auth/admin/login` |

Protected routes use `requireAuth`, plus `requireRole('admin')` (or `'student'`, `'faculty'`) where needed.
