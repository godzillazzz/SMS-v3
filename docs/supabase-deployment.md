# Supabase development deployment

Use a Supabase development project only. Keep `DATABASE_URL` as the SSL-enabled pooled runtime connection and use a private direct PostgreSQL URL for Prisma migration commands. Neither URL belongs in Vercel frontend variables, browser code, logs, or source control.

Before this deployment gate can pass, a project owner must provide a Supabase development connection through the approved secret mechanism. Then run `npx prisma migrate deploy`, `npx prisma migrate status`, `npx prisma generate`, and `npm run db:seed` from a trusted backend environment. Do not use a production Supabase project for validation.
