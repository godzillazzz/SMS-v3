# Supabase development database

Use a Supabase **development** project only. SMSV3 business logic stays provider-neutral: Prisma uses PostgreSQL through `DATABASE_URL`, and no Supabase SDK belongs in API services.

Copy `.env.supabase.example` to a private `.env` file. Use the pooled connection URL for the running API (`DATABASE_URL`) and the direct connection URL only when running Prisma migrations (`DIRECT_URL` is documentation-only in the current Prisma schema). Require `sslmode=require` for Supabase URLs. Never expose either URL, the database password, or the JWT secret to a browser or mobile client.

Before deploying, run migrations against the development database from a trusted environment. Do not point local tests, CI, backup prototypes, or this project at a production Supabase database.
