# SMS v3 UX/UI Route Redesign Matrix

Status date: 2026-07-28  
Scope: frontend presentation only on `feature/full-ui-redesign`.

The current React application is a single-page application that switches its
screen state internally; it does not use browser-path routing. The `Route`
column therefore records the application screen identifier, not a new URL.

| Route / screen id | Current component | Intended role | Target design | Status | Responsive | Accessibility | API / RBAC dependency | Remaining risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` unauthenticated | `Login` | Sign in, registration and password recovery | Split secure-access screen, clear feedback and form controls | COMPLETED | Desktop split; stacked mobile | Labels, error status and keyboard controls | Existing auth and OTP APIs | No localization selector because none exists |
| `dashboard` | `Dashboard` | Operations overview | Executive dashboard, KPI cards, attention and quick actions | PARTIAL | 4/2/1 KPI layout | Semantic headings and focus styles | Existing dashboard API and role-aware actions | Existing API does not provide organisation chart or full activity feed |
| `employees` | `Dashboard` employee branch | Personnel directory | Directory header, search, table, status and detail drawer | COMPLETED | Scrollable table; detail sheet on mobile | Button-labelled detail opening | Existing employee API; manager/admin actions unchanged | Column selector and aggregate filters need backend support |
| Personnel detail | `PersonnelDetailDrawer` | Read profile details and enter existing edit flow | Desktop right drawer / mobile full sheet | COMPLETED | Full sheet on mobile | Dialog semantics, labelled close control | Existing list data; edit remains role-gated | Employment, organisation, role and audit tabs are truthful read-only placeholders until APIs exist |
| `licenses` | `OperationalTable` | Employee licence registry | Compliance-oriented searchable table | PARTIAL | Horizontally scrollable table | Search label and visible focus ring | Existing licence API; ADMIN/MANAGER visibility | Dedicated summary metrics need aggregate endpoint |
| `shiftSetup` | `Dashboard` shift branch | Shift-code administration | Structured system table and modal forms | PARTIAL | Scrollable table | Semantic controls | Existing shift API and ADMIN restriction | No dedicated settings categories available |
| `schedule` | `Dashboard` schedule branch | Monthly shift operations | Schedule workbench, draft feedback and responsive table | PARTIAL | Sticky employee column / mobile horizontal scroll | Focus styles and touch targets | Existing schedule APIs and role checks | Dense grid remains intentionally data-first for operations |
| `leave` | `LeaveManagementPage` | Submit leave and personal history | Branded leave workspace, quota cards, form and personal history | COMPLETED | Two-column desktop / stacked mobile | Form labels, status and feedback | Existing leave API and role logic | Leave analytics are limited to existing data |
| `leavePending` | `LeaveManagementPage` | Pending approval queue | Approval workspace | PARTIAL | Responsive table | Status semantics | Existing manager/admin RBAC | No separate workflow endpoint beyond current list/update APIs |
| `leaveHistory` | `LeaveManagementPage` | All employee leave history | Full-width enterprise history table | PARTIAL | Scrollable table | Accessible status logs | Existing leave API; manager/admin view | Export remains existing print flow only |
| `quota` | `OperationalTable` | Leave quota administration | Compact governed data table | PARTIAL | Scrollable table | Focus states | ADMIN-only navigation and API | No aggregate reporting API |
| `rules` | `Dashboard` rules branch | Operations compliance | Compliance summary and governed checks | PARTIAL | Responsive cards/table | Tables and feedback states | Existing rule-check API; manager/admin controls | Not a complete audit-event console |
| `audit` | `OperationalTable` | Audit & compliance review | Compact audit console | PARTIAL | Scrollable table | Focus and readable status badges | Existing audit API; ADMIN-only | Date/actor/module filtering needs API query support |
| `users` | `Dashboard` user branch | Access management | User-role table with controlled actions | PARTIAL | Scrollable table | Form labels and state badges | Existing ADMIN/MANAGER RBAC | Tabs, permission matrix and request queue need supporting APIs |
| `reports` | `Dashboard` report branch | Data and reports | System summary/report surface | PARTIAL | Responsive cards | Empty/error feedback | Existing report summary API | No approved synchronization endpoint |
| `settings` | `SettingsPage` | System settings | Consistent settings forms and panels | PARTIAL | Stacked on mobile | Form labels and feedback | Existing settings API; ADMIN-only | Category navigation must wait for actual settings categories |
| session refresh | `AuthProvider` | Restore or end session | Session-safe loading and redirect | NOT MODIFIED | Existing behavior retained | Existing status/error feedback retained | Existing cookie/CSRF auth flow | Deliberately not changed by UX work |
| unauthorized / permission-denied | RBAC navigation and API errors | Keep blocked actions unavailable | Permission-safe empty/error presentation | PARTIAL | Responsive feedback | Non-technical messages and focus | Existing RBAC is unchanged | Dedicated path route does not exist |
| not found | N/A | Browser path fallback | Not applicable until router exists | NOT APPLICABLE | N/A | N/A | N/A | Adding a router would be an architecture change |
| internal error / API unavailable | `ErrorAlert`, table and loading states | Truthful operational feedback | Enterprise alert and retryable state pattern | PARTIAL | Responsive alert | `role=alert` on existing errors | Existing API error handling | Dedicated retry button requires page-specific safe reload |
| maintenance / offline | N/A | Operational state | Reusable visual treatment | BLOCKED | N/A | N/A | No actual status API/state | Must not invent operational state |
| confirmation and edit flows | `EditDialog`, browser confirmation | Guard destructive actions | Restrained dialog surface | PARTIAL | Full-width mobile dialog | Dialog labels; browser confirmation retained | Existing mutation APIs and role checks | Replace browser confirmations only after a review of each mutation flow |

## Screen coverage that cannot be introduced as a working route yet

`Organizational Structure`, `Data Synchronization`, and `System Health` appear
in the approved visual reference but do not have existing frontend route and
approved backend data contracts in this repository. No non-functional menu item
or fabricated status has been added. They remain blocked pending approved API
and RBAC requirements.
