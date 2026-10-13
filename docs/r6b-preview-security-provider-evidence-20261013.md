# R6-B Preview Security and Provider Evidence — Draft Review

## Purpose / restrictions

Stacked review on R6-B candidate fd6d878a3c781a85ac7e89235b72ed6520b4feb1.
No Production write, migration, SQL privilege change, secret retrieval, Workflow
dispatch, runtime probe, or release is performed by this change. Do not
merge into Integration or Production without a separate reviewed gate.

## Observed Preview posture, 2026-10-13 (read-only Supabase MCP)

Provider project reference: ezxanpfagitckpfsnflp (sms-v3-preview).
Provider-reported Production project reference: jkexwnlxnxbemwavsebv
(sms-v3-development). Project names are not evidence of Vercel runtime scope.

- 56 ordinary public tables; 35 RLS off, 21 RLS on without policies.
- All 35 RLS-off tables grant anon and authenticated SELECT; anon also
  has INSERT on all 35 (read-only catalog observations).
- Storage bucket license-documents-g05-preview: public=false;
  storage.objects RLS=true; no storage.objects policies.
- These are NOT production/runtime binding attestations.
- Full list and current state can be regenerated using
  scripts/security/r6b-preview-exposure-readonly.sql.

These broad Data API grants should be treated as a release-blocking finding.
Do not claim the API is unreachable unless the Data API is independently
confirmed disabled at the provider control plane.

## Preferred Preview remediation, not performed by this PR

1. Pin Preview AND Production runtime bindings independently before changing
   Preview provider configuration; a named "Preview" project might still be
   used by another deployment until runtime isolation is proven.
2. Confirm complete application and integration usage. Current source
   inspection shows backend Prisma and Supabase Storage REST calls
   (/storage/v1), not application calls to PostgREST (/rest/v1) or GraphQL;
   verify any out-of-repository clients before disabling.
3. If no Data API is required, use provider settings on
   https://supabase.com/dashboard/project/ezxanpfagitckpfsnflp/integrations/data_api/overview
   to disable **Enable Data API** for Preview only. Do not alter Storage API,
   Auth, RLS, Prisma tables, grants or migration history as a shortcut.
4. Independently verify that the Data API becomes unavailable (avoid
   requests that retrieve or modify real user data), that Prisma route,
   Preview health/readiness, and existing Storage paths remain healthy.
   Capture negative and positive test results; if an application dependency
   breaks, restore the control-plane setting and keep R6-B HOLD.
5. If disabling the Data API is not compatible, prepare a separately reviewed
   least-privilege migration on a disposable database copy. Establish a
   point-in-time ACL backup and run Prisma/Storage + anon/authenticated
   regression tests before any role REVOKE/RLS change.
6. Re-audit with the SQL inventory. Remaining catalog notices may still
   exist even after disabling Data API: report them accurately and do not
   label security PASS without the approved release-specific acceptance rule.

## Provider evidence code / limitations

scripts/ci/r6b-provider-metadata-readonly.cjs accepts two independently
supplied management credentials, makes fixed GET requests to the documented
Supabase Management API project and bucket metadata endpoints, and emits
an allowlisted, nonsecret project/bucket summary only. No key inventory,
secret values, Storage objects, business rows, SQL or mutations.

This is a provider **metadata preflight**. It does not prove that:
- the Vercel Preview Prisma connection reaches the Preview cluster;
- the Vercel Preview Storage key was issued by the Preview project;
- the live Production runtime is bound to the intended Production project.

It cannot make an isolation or RLS result PASS even on matching inputs.
No live provider HTTP request or secret configuration was run for this PR.
Before an operational runner is wired in, independently review the actual
Management API response shape, trusted source identity and credential scope;
the API may return a bare bucket array or a bucket-list envelope; both are supported, but undocumented shapes fail closed.

R6-B remains HOLD until provider scope, effective Runtime Prisma principal,
Storage issuer correlation, Production separation and Data API/RLS acceptance
are independently verified; live signed probes and protected Workflow runs
require separate Owner approval.
