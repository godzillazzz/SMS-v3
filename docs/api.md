# API notes

The API returns JSON. Successful collection responses use `{ "data": [...] }`; errors use `{ "error": "message" }`.

`GET /employees` accepts `page`, `pageSize` (maximum 100), `search`, `isActive`, and `department`. `GET /employees/:id` returns one active employee. DELETE is a soft delete. Basic USER accounts do not receive employee email, phone, or hire-date fields.

## Employee body

Required when creating: `employeeCode`, `firstName`, `lastName`.

Optional: `email`, `phone`, `department`, `jobTitle`, `hiredAt` (ISO date), and `isActive`. A `PUT` accepts any subset.

## Session endpoints

`POST /auth/login` returns an access token and a refresh token. The refresh token must be stored only in an appropriate secure client-side store and never logged. `POST /auth/refresh` accepts `{ "refreshToken": "..." }` and rotates it. `POST /auth/logout` revokes the supplied refresh token. `POST /auth/logout-all` requires a valid bearer access token and revokes all sessions for that user.

For a browser client, send `clientType: "browser"`. Refresh tokens are then HttpOnly cookies and are not in the JSON response. Browser refresh and logout require the `X-CSRF-Token` header to match the readable CSRF cookie. A mobile client must explicitly send `clientType: "mobile"` and uses the JSON refresh-token flow.

## Mobile readiness

Mobile clients use the same versioned REST API and bearer-token authentication. Do not embed privileged credentials in a mobile app. A future refresh-token/session module can be added alongside `auth.service.js` without changing employee routes.
