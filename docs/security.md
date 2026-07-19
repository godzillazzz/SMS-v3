# Security controls

Review Gate 1 requires `DATABASE_URL` and a 32-character-or-longer `JWT_SECRET` outside automated tests. Configuration is validated with Zod during startup. Production also requires an explicit comma-separated `CORS_ORIGIN` allowlist.

JWTs use HS256 only, a 30-minute default lifetime, configured issuer/audience, and a per-user token version. Each authenticated request confirms the user is still active and the token version is current.

Login attempts are rate limited by IP, return one generic invalid-credential message, and are audited without passwords. Successful logins reset `failedLoginCount`; failures increment it for known users. Password hashes, tokens, and secrets are never returned or placed in audit metadata.

Refresh tokens are cryptographically random, database-backed session credentials. Only SHA-256 hashes are stored. Every refresh rotates the token; reuse of a rotated/revoked token revokes every session and increments the user's token version. Refresh-token expiry is configurable with `REFRESH_TOKEN_EXPIRES_DAYS`.

Errors include a correlation ID. Production 500 responses are sanitized; detailed errors remain in server logs.

Remaining limitation: the in-memory login limiter is suitable for one server only. Replace it with a shared Redis-backed limiter before horizontally scaling.
