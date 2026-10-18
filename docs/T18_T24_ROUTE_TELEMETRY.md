# T18 / T24 — redacted route telemetry

Generated: 2026-10-18T23:44:44.262Z
Canonical: https://sms-v3-staging-ten.vercel.app · 12 requests per route · 700 ms gap (sequential)

| Route | Kind | Expected | Observed | p50 | p95 | max | failures |
|---|---|---|---|---|---|---|---|
| `/api/v1/health` | public | 200 | 200 | 125.4 ms | 345.9 ms | 345.9 ms | 0 |
| `/api/v1/ready` | public | 200 | 200 | 144.4 ms | 228.9 ms | 228.9 ms | 0 |
| `/api/v1/approval-center` | auth-gate | 401/403 | 401 | 123.9 ms | 238 ms | 238 ms | 0 |
| `/api/v1/schedules?month=2026-10` | auth-gate | 401/403 | 401 | 122.4 ms | 203.9 ms | 203.9 ms | 0 |
| `/api/v1/employees?page=1&pageSize=20` | auth-gate | 401/403 | 401 | 124 ms | 162.7 ms | 162.7 ms | 0 |
| `/api/v1/attendance/history?days=7` | auth-gate | 401/403 | 401 | 123.1 ms | 160.1 ms | 160.1 ms | 0 |
| `/api/v1/dashboard` | auth-gate | 401/403 | 401 | 125 ms | 131.7 ms | 131.7 ms | 0 |
| `/` | shell | 200 | 200 | 35.8 ms | 41 ms | 41 ms | 0 |

Public p95 (worst route): **345.9 ms**
Auth-gate p95 (worst route): **238 ms**

## Limitation
Authenticated per-role latency is NOT measured: no approved UAT account is available (F004). No business data is returned by these requests.

Machine-readable evidence: `docs/evidence/t18-route-telemetry-20261018.json`