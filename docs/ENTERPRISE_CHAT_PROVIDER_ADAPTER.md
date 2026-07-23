# Enterprise Chat Provider Adapter

This document details the architecture, design, and validation status of the Enterprise Chat Provider Adapter.

---

## 1. Design & Architecture
- **Adapter Purpose**: Provide a secure outbound channel for sending sanitized system alerts to an external enterprise chat system.
- **Disabled-by-Default Behavior**: The adapter remains completely inactive unless `ALERTING_ENABLED=true` and `ALERTING_PROVIDER=enterprise_chat` are explicitly configured in the environment.
- **Prerequisite Approval**: Before controlled staging activation (Gate 5.10C retry), formal owner approvals for destination and credential vault registration must be secured.

---

## 2. Configuration Parameters
*New configuration keys are documented below by name only. Real values must not be committed to Git or local `.env` files.*

- `ALERTING_ENABLED`: General toggle (`true` / `false`).
- `ALERTING_PROVIDER`: Set to `enterprise_chat` to activate this adapter.
- `ALERTING_API_TOKEN`: Cryptographic authorization token. Must be mapped securely from the credential vault.
- `ALERTING_DESTINATION_ID`: Target channel/webhook identifier.
- `ALERTING_TIMEOUT_MS`: Network request timeout limit in milliseconds (defaults to `5000`).

---

## 3. Security & Safety Rules
- **Payload Sanitization**: The outbound payload includes only safe, non-identifying schema fields:
  - `timestamp`: Event generation time.
  - `event`: Event identifier category.
  - `level`: Log level (`info` / `warn` / `error`).
  - `status`: HTTP status code (if applicable).
  - `errorCategory`: Sanitized classification of the error.
  - `message`: Descriptive message string.
- **Strict Exclusions**: Outbound payloads and local logs must never contain:
  - Raw request bodies or headers.
  - User cookies, JWT tokens, or CSRF values.
  - Live employee details or database identifiers.
  - Server stack traces or database connection hostnames.
- **Redaction Rules**: The adapter must never log the `ALERTING_API_TOKEN` or `ALERTING_DESTINATION_ID` values.

---

## 4. Timeout, Deduplication, & Mock Tests
- **Timeout Behavior**: Bounded timeout is enforced using the `AbortController` signal during network calls. Failures are handled safely returning `{ delivered: false, status: 'failed', error: 'timeout' }`.
- **Deduplication Integration**: Outbound delivery routes directly through the existing `AlertPolicyEngine`, utilizing the active cooldown window to suppress duplicates before they trigger network traffic.
- **Mock Tests**: 100% of the adapter behaviors are covered by mock-only unit tests in [test/alerting.test.js](file:///c:/Users/sermp/OneDrive/ドキュメント/Move%20Gas/test/alerting.test.js#L216-L300) with zero external calls or live network access.

---

## 5. Next Steps for Gate 5.10C Retry
1. Verify all unit tests continue to pass.
2. Confirm the rollback plan and change management ticket are registered.
3. Configure the destination and credential variables securely outside Git.
4. Execute Controlled Staging Activation in a separate dedicated gate.
