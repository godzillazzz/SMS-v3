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
