# Owner Review Action Item Tracker

All action items default to **OPEN** status. These items represent required steps before a production Go/No-Go check may be conducted.

---

## Action Item Matrix

| Action Item | Owner Role | Required Input | Dependency | Evidence to Attach (Outside Git) | Status | Blocker Impact |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Assign Application Owner** | Business Owner | Staff assignment | None | Signed role mapping sheet | **CLOSED** | Blocks production release |
| **Assign Technical Owner** | Business Owner | Staff assignment | None | Signed role mapping sheet | **CLOSED** | Blocks staging acceptance |
| **Assign Database Owner** | Business Owner | Staff assignment | None | Signed role mapping sheet | **CLOSED** | Blocks data migration |
| **Assign Security Owner** | Business Owner | Staff assignment | None | Signed role mapping sheet | **CLOSED** | Blocks security sign-off |
| **Assign Privacy/PDPA Owner**| Business Owner | Staff assignment | None | Signed role mapping sheet | **CLOSED** | Blocks PDPA review |
| **Assign Infrastructure Owner**| Business Owner | Staff assignment | None | Signed role mapping sheet | **CLOSED** | Blocks production deployment|
| **Select Notification Channel Category**| Notification Owner| Category choice | DEC-03 | Selection outcome document | **CLOSED** | Blocks channel activation |
| **Approve Alert Thresholds** | Monitoring Owner | Alert rules config | DEC-04 | Dashboards config screenshot | **CLOSED** | Blocks operational alerting |
| **Approve Backup Host** | Backup Owner | Server specs | DEC-05 | Host compliance checklist | **CLOSED** | Blocks backup scheduling |
| **Approve Backup Storage** | Backup Owner | NAS folder permissions| DEC-06 | Network mapping logs sheet | **CLOSED** | Blocks backup scheduling |
| **Approve Encryption Key** | Security Owner | Keyring generation | DEC-07 | Public GPG key file | **CLOSED** | Blocks backup encryption |
| **Approve Backup Schedule** | Backup Owner | Task scheduler setup | DEC-08 | Scheduled task export XML | **CLOSED** | Blocks backup scheduling |
| **Approve Restore Schedule** | Restore-Test Owner | Rehearsal task config | DEC-09 | Task execution log sheet | **CLOSED** | Blocks restore testing |
| **Approve Pilot Participants** | Application Owner | Tester list | DEC-02 | Anonymized user listing sheet| **CLOSED** | Blocks staging pilot start |
| **Approve Real Import Criteria**| Privacy/PDPA Owner | Script verification | DEC-10 | Script check review sheet | **OPEN** | Blocks database migration |
| **Accept Pilot Closeout** | Application Owner | Closeout review sign-off | DEC-CP-01 | Signed closeout review form | **CLOSED** | Blocks operational planning |
| **Request Additional Evidence** | Security Owner | Evidence verification requests | DEC-CP-04 | Audit request logs | **CLOSED** | Blocks operational planning |
| **Authorize Next Operational Gates**| Business Owner | Phase entry approval | DEC-CP-06 | Signed phase transition form | **CLOSED** | Blocks operational planning |
| **Assign Owners for Notification**| Business Owner | Notification owners mapping | None | Signed role mapping sheet | **CLOSED** | Blocks notification setup |
| **Assign Owners for Backup** | Business Owner | Backup owners mapping | None | Signed role mapping sheet | **OPEN** | Blocks backup setup |
| **Prepare Production Go/No-Go** | Business Owner | Sign-off package compilation | DEC-11 | Completed sign-off grids | **OPEN** | Blocks production release |
| **Approve Notification Credential Custody**| Security Owner| Secret management plan| DEC-12 | Vault access logs checklist | **CLOSED** | Blocks channel activation |
| **Approve Recipient/Destination Outside Git**| Privacy/PDPA Owner| Destination validation| DEC-13 | Anonymized registry entry | **CLOSED** | Blocks channel activation |
| **Approve Staging Notification Activation Change**| Business Owner| Change window ticket | DEC-14 | Active change ticket | **CLOSED** | Blocks channel activation |
| **Approve Synthetic Notification Test**| Technical Owner| Test suite validation | DEC-15 | Verification test log trace | **CLOSED** | Blocks channel activation |
| **Assign Notification Rollback Owner**| Business Owner| Staff assignment | None | Signed rollback role sheet | **CLOSED** | Blocks channel activation |
| **Approve Controlled Staging Notification Test Closeout**| Notification Owner| Review staging closeout summary | DEC-12 | Owner signature placeholder | **CLOSED** | Blocks future production change planning |
| **Request Additional Synthetic Test**| Notification Owner| Additional test request option | None | Staging activation log sheet | **CLOSED** | Blocks production change planning |
| **Prepare Production Notification Change Plan**| Release Manager| Change management registry | None | Signed change execution runbook | **OPEN** | Blocks production notification release |
| **Define Production Notification Approval Evidence**| Security Owner| Production vault registration | None | Vault audit logs checklist | **OPEN** | Blocks production notification release |
| **Confirm Notification Remains Disabled After Rollback**| Technical Owner| Staging configuration validation | None | Vercel scope settings check | **CLOSED** | Blocks production notification release |
