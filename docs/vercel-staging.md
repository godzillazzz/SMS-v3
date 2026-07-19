# Vercel staging deployment

Deploy this repository as one Vercel project. Vercel builds `frontend/` into the SPA served at `/`; `api/index.js` serves the existing Express application. `vercel.json` routes `/api/v1/*` to the API function before the SPA fallback, so API routes never resolve to `index.html`.

Set these **server-side Vercel Environment Variables** for Preview/Staging: `DATABASE_URL` (Supabase Session Pooler), `DIRECT_URL` (only for a controlled manual migration command), `JWT_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRES_IN`, `NODE_ENV=production`, `CORS_ORIGIN`, `COOKIE_SECURE=true`, and `COOKIE_SAME_SITE=lax`. Do not define a database URL, JWT secret, or any other secret as a `VITE_` variable.

Run migrations from a controlled trusted terminal before deployment: `npx prisma migrate deploy`. Runtime API requests never run migrations. Use explicit preview/staging origins in `CORS_ORIGIN`; do not use a wildcard with credentials.
