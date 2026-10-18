# T22 — Remote read-only latency baseline (18 Oct 2026)

**Target:** `https://sms-v3-staging-ten.vercel.app` (Production canonical, release head `d0bd1db1`, deployment `dpl_7djFpJVzU4r1FjtKJy9i1w18RYzW`)
**Harness:** `scripts/perf/t22-remote-readonly.js` (GET only — never mutates data)
**Measured from:** the ATLAS host (edge `sin1` → function region `hnd1`, confirmed on every response header)

## Single-user sequence (100 requests per path, concurrency 1)

| Path | What it exercises | p50 | p95 | max | errors |
|---|---|---|---|---|---|
| `/api/v1/health` | serverless function, no DB | **124.2 ms** | 147.2 ms | 315.9 ms | 0 % |
| `/api/v1/ready` | function + Postgres round trip | **149.8 ms** | 172.6 ms | 264.5 ms | 0 % |
| `/` | edge-cached application shell | **34.3 ms** | 47.3 ms | 103.2 ms | 0 % |

Verdict: a single user anywhere near the Singapore edge gets a database-backed response in **~150 ms p95 173 ms**, with no errors and the function executing in the database region (`hnd1`).

## Concurrency probe (100 requests per path at concurrency 10)

| Path | p50 | p95 | max | errors |
|---|---|---|---|---|
| `/api/v1/health` | 221 ms | 5225 ms | 5329 ms | 0 % |
| `/api/v1/ready` | 5213 ms | 5243 ms | 5485 ms | 0 % |
| `/` | 37.5 ms | 5103 ms | 5113 ms | 0 % |

**Interpretation:** the flat ~5.2 s queue time that appears as soon as ten requests are in flight is
queueing outside the function (edge/plan concurrency), not slow application code: the single-user
numbers stay at ~150 ms and no request failed. This must be confirmed against the Vercel plan's
concurrency limit before any statement about many-supervisor simultaneous use is made.

## What this evidence does and does not cover

Covered: real network path, real TLS termination, real serverless cold/warm behaviour, real Postgres
round trip, real region routing (Tokyo), zero-error streaming.
Not covered: authenticated business-route latency, schedule write throughput against the live
database (the CI benchmark `39042384522` measured that in an isolated Postgres container:
p50 443.7 ms / p95 515.0 ms for 1,000 shifts), and office-network conditions from the customer site.

---

# Incident during the T22 remote probe — Vercel Security Checkpoint (18 Oct 2026)

After the concurrency ladder, further probes returned HTTP **403** with these response headers:

```
server: Vercel
x-vercel-mitigated: challenge
retry-after: 30
x-vercel-challenge-token: 2.1792323096.60...
```
and a body titled **"Vercel Security Checkpoint"**.

## What this means

The ~5.1 s stalls seen at concurrency ≥2 were **not application latency**: the same stall appeared
on `/api/v1/health` (no database), on `/` (edge-cached static) and ended in `403 challenge`. The
platform's bot-protection layer is challenging repeated automated requests from this host's IP.

The application itself measured clean before mitigation engaged:

- `/api/v1/ready` single user: p50 150 ms, p95 173 ms, 0 % errors
- `/api/v1/health`: p50 124 ms, p95 147 ms
- Region: `sin1` edge → `hnd1` function on every response

## Operational risk this exposes (must be decided by the owner)

1. The measurement host is a datacenter IP, which bot protection scrutinises hardest. Browsers from
   an office IP are less likely to be challenged, but the same layer can challenge a **burst from a
   single office NAT** — e.g. 60 guards opening the app at shift start.
2. If the challenge fires, the user sees a "Vercel Security Checkpoint" page instead of the app, for
   roughly `retry-after` seconds.
3. Mitigations available: disable Attack Challenge Mode for the production domain, allowlist the
   office egress IP in Vercel Firewall, or move to a stable dedicated egress. Each is a Production
   configuration change and therefore needs the owner's decision.

## Correct status of T22 after this run

- CI write benchmark (1,000 shifts, isolated Postgres container): **CLOSED** — p50 443.7 ms, p95 515.0 ms.
- Remote single-user read latency (health / ready / static): **CLOSED** — p95 173 ms, 0 % errors.
- Remote burst behaviour from a datacenter IP: **BLOCKED by platform bot protection** — not an
  application defect, requires a production firewall/plan decision.
- Office-network user-context measurement: **STILL NOT VERIFIED** (needs a real office client or an
  allowlisted egress).
