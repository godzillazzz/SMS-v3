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
| **Approve Notification Channel**| Notification Owner| Provider choice | DEC-03 | Vendor SLA and invoice | **OPEN** | Blocks telemetry alerts |
| **Approve Alert Thresholds** | Monitoring Owner | Alert rules config | DEC-04 | Dashboards config screenshot | **OPEN** | Blocks operational alerting |
| **Approve Backup Host** | Backup Owner | Server specs | DEC-05 | Host compliance checklist | **OPEN** | Blocks backup scheduling |
| **Approve Backup Storage** | Backup Owner | NAS folder permissions| DEC-06 | Network mapping logs sheet | **OPEN** | Blocks backup scheduling |
| **Approve Encryption Key** | Security Owner | Keyring generation | DEC-07 | Public GPG key file | **OPEN** | Blocks backup encryption |
| **Approve Backup Schedule** | Backup Owner | Task scheduler setup | DEC-08 | Scheduled task export XML | **OPEN** | Blocks backup scheduling |
| **Approve Restore Schedule** | Restore-Test Owner | Rehearsal task config | DEC-09 | Task execution log sheet | **OPEN** | Blocks restore testing |
| **Approve Pilot Participants** | Application Owner | Tester list | DEC-02 | Anonymized user listing sheet| **CLOSED** | Blocks staging pilot start |
| **Approve Real Import Criteria**| Privacy/PDPA Owner | Script verification | DEC-10 | Script check review sheet | **OPEN** | Blocks database migration |
