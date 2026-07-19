# Vercel frontend development

Deploy only the `frontend/` directory to Vercel. Set `VITE_API_BASE_URL` to the public versioned API base URL, such as `https://api-development.example.com/api/v1`; this value contains no secret. Add the Vercel preview and production origins explicitly to backend `CORS_ORIGIN`, separated by commas. Cookie credentials are enabled only for allowlisted origins—never use wildcard CORS with credentials.

When frontend and API use different sites, validate browser cookie behavior before production. Keep `COOKIE_SAME_SITE=lax` unless a documented cross-site design requires a stricter review.
