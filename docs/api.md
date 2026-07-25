# API notes

The API returns JSON. Successful collection responses use `{ "data": [...] }`; errors use `{ "error": "message" }`.

`GET /employees` accepts `page`, `pageSize` (maximum 100), `search`, `isActive`, and `department`. `GET /employees/:id` returns one active employee. DELETE is a soft delete. Basic `VIEWER` accounts do not receive employee email, phone, or hire-date fields. `ADMIN` and `MANAGER` can create or update employees; delete remains `ADMIN` only. `ADMIN` and `MANAGER` can list users without password hashes.

## Employee body

Required when creating: `employeeCode`, `firstName`, `lastName`.

Optional: `email`, `phone`, `department`, `jobTitle`, `hiredAt` (ISO date), and `isActive`. A `PUT` accepts any subset.

## Session endpoints

`POST /auth/login` returns a short-lived access token. Mobile clients also receive a rotating refresh token; browser clients receive the refresh token only as a Secure, HttpOnly cookie. `POST /auth/refresh` rotates the refresh session. `POST /auth/logout` revokes the current session. `POST /auth/logout-all` requires a valid bearer access token and revokes all sessions for that user.

For a browser client, send `clientType: "browser"`. Refresh tokens are then HttpOnly cookies and are not in the JSON response. Browser refresh and logout require the `X-CSRF-Token` header to match the readable CSRF cookie. A mobile client must explicitly send `clientType: "mobile"` and uses the JSON refresh-token flow.

## Mobile readiness

Mobile clients use the same versioned REST API and bearer-token authentication. Do not embed privileged credentials in a mobile app. A future refresh-token/session module can be added alongside `auth.service.js` without changing employee routes.

## Legacy workflow parity endpoints

- `POST /schedule/auto-preview` (Admin) calculates the legacy Supervisor/rotating schedule without writing. Locked assignments and approved leave (`AL`) are preserved.
- `POST /schedule/auto-commit` (Admin) recalculates and writes the preview atomically, creates a pending schedule revision, and writes an audit event.
- `POST /schedule/export.xlsx` exports only the latest approved revision. The workbook contains one formatted worksheet per selected department, shift colors, totals, legend, Buddhist-year heading, and signature sections.
- `POST /leave-requests/with-attachment` accepts multipart form data with one optional `attachment` (PDF, JPEG, or PNG; maximum 4 MB). Binary content is stored transactionally in PostgreSQL and never returned in JSON.
- `GET /leave-requests/:id/attachment` streams an authorized attachment with private, no-store headers. A Viewer can access only their own leave attachment.
- `POST /users/:id/view-as` (Admin) issues a ten-minute, memory-only, read-only access token for the selected active account. It creates no refresh session and all mutation attempts are rejected server-side.
