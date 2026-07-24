# smsv3

The backend foundation for smsv3. It uses Express, PostgreSQL, Prisma, and JWT authentication—no Google Sheets or Google Apps Script is used as production storage.

## Project layout

```
src/
  config/       environment and database client
  middlewares/  auth and consistent error handling
  routes/       HTTP endpoint definitions
  services/     business logic and audit extension point
prisma/         PostgreSQL schema and seed script
scripts/        operational scripts, including backup placeholder
docs/           API and deployment notes
```

## Local setup

1. Install Node.js 22.x and PostgreSQL 15 or later.
2. Copy `.env.example` to `.env` and replace all example secrets.
3. Create an empty PostgreSQL database named `smsv3` (or change `DATABASE_URL`).
4. Install dependencies: `npm install`.
5. Create tables: `npm run prisma:migrate -- --name initial`.
6. Create the initial administrator: `npm run db:seed`.
7. Start the API: `npm run dev`.

## Local PostgreSQL and integration tests

Docker Compose creates isolated `sms_v3_dev` and `sms_v3_test` databases. Set local-only `POSTGRES_USER` and `POSTGRES_PASSWORD`, then run `docker compose up -d` and wait for the health check. Copy `.env.development.example` or `.env.test.example` to a private `.env` file, then run `npm run prisma:deploy` for development or `npm run db:test:migrate` for testing. Stop the local database with `docker compose down`; add `-v` only when you intentionally want to remove local database data.

Run unit tests with `npm test`. Run real database tests only against the isolated test database: `RUN_INTEGRATION_TESTS=true npm run test:integration`. The integration suite refuses a URL that does not contain `sms_v3_test`.

The service is available at `http://localhost:3000`; use `GET /health` as a health check.

## API

All API routes are versioned under `/api/v1`. Send `Authorization: Bearer <accessToken>` to protected routes.

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/login` | Public | Receive a JWT access token |
| GET | `/api/v1/users` | Admin, Manager | List application users |
| GET | `/api/v1/employees` | Any signed-in user | List employees |
| POST | `/api/v1/employees` | Admin, HR, Manager | Create an employee |
| PUT | `/api/v1/employees/:id` | Admin, HR, Manager | Update an employee |
| DELETE | `/api/v1/employees/:id` | Admin | Delete an employee |

Example login body:

```json
{ "email": "admin@example.com", "password": "your-password" }
```

## Database portability and operations

Prisma uses one `DATABASE_URL`; moving from a managed/cloud database to a company-hosted PostgreSQL server is a configuration change. Run `npm run prisma:deploy` against the new database to apply the same versioned migrations.

The legacy Google Sheets export is migrated with a source-only dry run and an explicitly enabled one-time PostgreSQL importer. Source files must remain outside the repository. See the [legacy SMS data migration guide](docs/legacy-data-migration.md) for dataset mappings, role handling, password-reset requirements and cutover controls.

`npm run backup` is deliberately a safe placeholder. See [backup plan](docs/backup.md) before connecting it to a company scheduler. Audit records are written centrally through `src/services/audit.service.js` for employee mutations and logins.

## Security and review gate

Copy `.env.example` to `.env` and provide a real database URL, a JWT secret of at least 32 characters, and an explicit production CORS allowlist. Access tokens last 30 minutes by default and are validated against the active user and token version on every protected request. See [security controls](docs/security.md) and [Technical Review Gate 1](docs/technical-review-gate-1.md).

## CI

GitHub Actions installs locked dependencies, generates the Prisma client, and runs tests for pushes and pull requests to `main`. Add a lockfile by running `npm install` before the first commit.

The CI gate also checks Prisma formatting, validates the schema, and runs `npm audit --audit-level=high`; it does not change dependencies automatically.

## Sessions, Supabase and backups

Login returns a short-lived access token and a rotating refresh token; see [security controls](docs/security.md). For a Supabase development project, follow [Supabase development](docs/supabase-development.md). The backup prototype and restore procedure are documented in the [backup runbook](docs/backup-runbook.md); they are not yet production-ready.
