# Real Notification Activation Change Plan

## Overview
This document outlines the future controlled activation sequence for enabling real notification delivery. Under Gate 5.6C, no real delivery channel is active, and no credentials or destinations are configured.

## Controlled Activation Sequence
1. **Channel Selection**: Obtain final channel selection approval from `[APPLICATION_OWNER]`.
2. **Owner Assignment**: Assign accountable owners for monitoring and alert response in `docs/OPERATIONAL_OWNERSHIP.md`.
3. **Threshold Approval**: Approve warning and critical thresholds in `docs/ALERT_THRESHOLD_APPROVAL.md`.
4. **Secure Configuration**: Configure the destination and credentials securely on Vercel staging using environment variable placeholders:
   - `ALERTING_ENABLED`
   - `ALERTING_PROVIDER`
   - `ALERTING_SECRET`
   - `ALERTING_DESTINATION`
5. **Staging Deployment**: Deploy the configured environment changes to the `sms-v3-staging` Vercel project.
6. **Synthetic Verification**: Trigger a synthetic staging event to verify end-to-end delivery.
7. **Acknowledgement Check**: Confirm the primary owner receives and can acknowledge the alert within target timeframes.
8. **Failure Handling**: Simulate a notification destination failure and verify that the application logs the failure sanitarily and continues normal operation.
9. **Deduplication Verification**: Trigger duplicate synthetic events to confirm they are aggregated and suppressed on staging.
10. **Cooldown Verification**: Confirm that cooldown duration suppresses notifications successfully.
11. **Rollback Test**: Verify the rollback procedure by disabling `ALERTING_ENABLED` and redeploying.
12. **Evidence Preservation**: Document and save sanitized logs as evidence of successful verification.

## Go/No-Go Decision Points
- **Go**: All staging tests pass, acknowledgement is confirmed within targets, deduplication behaves as expected, and rollback is verified.
- **No-Go**: Staging deployment fails, credentials or secrets leak in build logs, notification failures block application login/registration, or rollback fails to immediately disable alert routing.

## Rollback Criteria
In the event of an unexpected outage or performance degradation:
- Revert Vercel environment variables by setting `ALERTING_ENABLED=false`.
- Redeploy immediately to ensure no network calls to the notification provider are attempted.
