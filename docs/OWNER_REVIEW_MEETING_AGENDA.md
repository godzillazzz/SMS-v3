# Owner Review Meeting Agenda

## 1. Project Objective
Transition the SMS v3 application from a staging-only configuration to a production-active environment under strict compliance, data protection, and operational ownership approvals.

---

## 2. Meeting Agenda Outline

### Session A: Staging Technical Status (15 Mins)
- Review of the currently linked `sms-v3-staging` project.
- Verification of staging alias `sms-v3-staging-ten.vercel.app`.
- Review of completed legacy project deconfliction (successful rename of legacy project `sms-v3` to `sms-v3-legacy-do-not-use`).

### Session B: Technically Verified Controls (20 Mins)
- Shared rate limiting: Fixed-window rate limiter with hashed client keys.
- Authentication: Secure multi-token configuration with HttpOnly, Lax, Secure session cookies and CSRF protection.
- Safe logging: Redaction verification of credentials, PII, and raw database parameters in NDJSON log streams.
- Backup templates: Safety validation test harness execution metrics.

### Session C: Remaining Production Blockers (20 Mins)
- Review of the 14 open blockers documented in `docs/PRODUCTION_BLOCKER_CLOSURE_TRACKER.md`.
- Focus on operational owner mapping, notification channels, backup destinations, GnuPG key custody, and PDPA compliance sign-offs.

### Session D: Required Owner Decisions (30 Mins)
- Presentation of decision templates from `docs/OWNER_DECISION_LOG.md`.
- Review of prerequisite evidence required for each role to sign off.

### Session E: Prohibited Actions & Scope Restrictions (15 Mins)
- Strict prohibition of importing real employee data before formal checklist sign-off.
- Confirmation that notification delivery and automated backups remain inactive.

### Session F: Next Gates & Meeting Outputs (20 Mins)
- Review of Phase 4 (Staging Pilot) entry criteria.
- Capturing action items in `docs/OWNER_REVIEW_ACTION_ITEM_TRACKER.md`.
- Target scheduling for the formal Go/No-Go check.
