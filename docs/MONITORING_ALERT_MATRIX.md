# Monitoring Alert Matrix

## Approval status

All thresholds below are suggested staging baselines. They require named operational ownership, observation against approved staging traffic and explicit approval before production use. They do not represent current or forecast production traffic volumes.

No paid external monitoring service is activated by this document.

| Condition | Signal source | Observation window | Suggested warning | Suggested critical | Severity | First response | Escalation owner | False-positive considerations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Readiness unavailable | Authenticated readiness probe, `readiness_failure` | 5 minutes | 2 failures | 5 consecutive failures or unavailable for 5 minutes | Warning / SEV-1 | Confirm health separately, inspect safe function and database availability signals, freeze deployment | `[INCIDENT_COMMANDER]`, `[DATABASE_OWNER]` | Planned database maintenance, brief network transition |
| HTTP 5xx rate | `http_request`, `unexpected_http_5xx`, Vercel status | 5 minutes | At least 5 responses and 2% of requests | At least 10 responses and 5% of requests | Warning / SEV-1 | Identify route/event category and last Ready deployment; preserve request IDs | `[TECHNICAL_OWNER]` | Synthetic negative tests, low-volume percentage distortion |
| HTTP 429 rate | `http_request`, `rate_limit_denied` | 10 minutes | 10 denials | 30 denials or sustained growth for 10 minutes | Warning / SEV-2 | Check for attack/test activity and shared-store health; do not weaken limits immediately | `[SECURITY_CONTACT]` | Approved load/security tests, repeated invalid sample login |
| Rate-limit HTTP 503 | `rate_limit_store_unavailable`, HTTP status | 5 minutes | 1 occurrence | 2 occurrences or any sustained occurrence | SEV-2 / SEV-1 | Check readiness/database latency and connection capacity; limiter must remain fail closed | `[TECHNICAL_OWNER]`, `[DATABASE_OWNER]` | Controlled isolated test must not target hosted staging |
| Login failure spike | `authentication_failure`, audit aggregate | 5 minutes | 10 failures | 25 failures or repeated spike across 2 windows | Warning / SEV-2 | Check authorized test schedule and 429 trend; preserve safe request IDs | `[SECURITY_CONTACT]` | User testing, stale sample credential, approved security test |
| Refresh failure spike | `refresh_failure`, HTTP 401 | 5 minutes | 5 failures | 15 failures or rising failures after deployment | Warning / SEV-2 | Compare deployment time, session/audit aggregates and cookie/CSRF regression results | `[APPLICATION_OWNER]` | Expired browser sessions, intentional logout-all test |
| Function timeout | Vercel function duration/timeout signal | 10 minutes | 1 timeout | 3 timeouts | Warning / SEV-1 | Identify route template and dependency latency; stop new deployment if correlated | `[TECHNICAL_OWNER]` | Cold starts, approved long-running diagnostic |
| Database latency | Readiness duration, Supabase query/resource monitoring | 10 minutes | p95 readiness above 500 ms | p95 above 1,500 ms for 5 minutes or connection saturation | Warning / SEV-1 | Check pooler connections, query/resource signals and recent schema/deployment change | `[DATABASE_OWNER]` | Cold connection, platform maintenance, single low-volume outlier |
| Rate-limit table growth | Safe database aggregate count/storage | 24 hours | More than 10,000 active/expired rows | More than 50,000 rows or accelerating growth across 2 checks | Warning / SEV-2 | Verify expiry index and cleanup results; do not delete another table | `[DATABASE_OWNER]`, `[TECHNICAL_OWNER]` | Approved rate-limit/load test, cleanup not yet scheduled |
| Expired-row cleanup failure | `rate_limit_cleanup_failure`, missing cleanup result | Per approved cleanup execution / 24 hours | 1 failed execution | 2 consecutive failures or growth threshold also exceeded | Warning / SEV-2 | Re-run only after cause review; confirm exact table/predicate and database health | `[DATABASE_OWNER]` | No cleanup scheduled yet; execution deliberately deferred |
| Backup failure placeholder | Approved backup result/notification when scheduling exists | Per scheduled job | First failed/missing result | 2 consecutive failures or restore verification overdue | Warning / SEV-1 | Preserve failure category, verify last valid backup/checksum, do not expose artifacts | `[BACKUP_OWNER]` | Automated Windows Server/NAS scheduling is currently deferred |

## Implementation notes

- Percentage thresholds require a minimum event count to reduce low-volume false positives.
- A notification must contain only event category, severity, time window, safe aggregate count and request IDs when needed.
- Notifications must not contain raw identities, employee data, headers, bodies, credentials, tokens, cookies, stored hashes or connection details.
- Threshold changes require a recorded reason, reviewer and rollback decision.
- Real notification delivery and escalation tests are required before overall Gate 5.6 can close.
