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
| 409 | Already exists (email or ID number) |
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

## Roles (for future endpoints)

| Role | How it's created | Login page |
|---|---|---|
| `student` | Sign-up | `/auth/login` |
| `faculty` | Sign-up | `/auth/login` |
| `admin` | `SEED_ADMIN_*` in `.env` | `/auth/admin/login` |

Protected routes use `requireAuth`, plus `requireRole('admin')` (or `'student'`, `'faculty'`) where needed.
