# SMS v3 UX/UI route redesign matrix

This inventory describes the user-visible views currently implemented by the frontend. The redesign is presentation-only: existing API contracts, browser authentication and role checks are retained.

| View | Existing page | Target treatment | Responsive | API / RBAC dependency | Status |
| --- | --- | --- | --- | --- | --- |
| Login, registration and OTP reset | `LoginPage` | Secure split-screen sign-in with clear form states | Desktop, tablet, mobile | Existing auth endpoints | COMPLETED |
| Dashboard | `Dashboard` | Enterprise shell, KPI cards, attention and quick actions | Desktop, tablet, mobile | Dashboard endpoint / role visibility | COMPLETED |
| Personnel Directory | `Dashboard` employees view | Search, summary table and profile drawer surface | Desktop table, mobile scroll | Employees endpoint / manager actions | COMPLETED |
| Employee licences | Operational table | Consistent management table and state badges | Desktop, tablet, mobile | Licences endpoint / ADMIN and MANAGER | COMPLETED |
| Monthly schedule and shift setup | Schedule views | Operational controls, tables and responsive horizontal handling | Desktop, tablet, mobile | Schedule endpoints / existing RBAC | COMPLETED |
| Leave request, pending queue and history | `LeaveManagementPage` | Quota cards, request form and history cards | Desktop, tablet, mobile | Leave endpoints / existing approval rules | COMPLETED |
| Leave quota | Operational table | Consistent data surface and empty/error state | Desktop, tablet, mobile | Quota endpoint / ADMIN | COMPLETED |
| Rules and audit log | Operational table | Governance data surfaces and status badges | Desktop, tablet, mobile | Existing endpoints / RBAC | COMPLETED |
| Organizational Structure | Not implemented | Enterprise hierarchy workspace | Desktop, tablet, mobile | No existing route, API, domain model, hierarchy data, organization-specific RBAC rule, or supported workflow | BLOCKED |
| Audit & Compliance | `audit` via `OperationalTable` | Structural compliance console with safe normalized events | Desktop, tablet, mobile | `/api/v1/audit-events` / ADMIN only | IN PROGRESS |
| Users and roles | Users view | Access-management table with role/status controls | Desktop, tablet, mobile | User endpoint / ADMIN and MANAGER | COMPLETED |
| Reports | Reports view | Reusable report cards and action controls | Desktop, tablet, mobile | Existing report data / RBAC | COMPLETED |
| Settings | `SettingsPage` | Card-based administrative settings | Desktop, tablet, mobile | Settings endpoint / ADMIN | COMPLETED |
| Dialog, drawer, loading, empty, error | Shared components | Unified surfaces, focus treatment and message hierarchy | Desktop, tablet, mobile | Existing component state | COMPLETED |

## Not created

Organizational Structure is **BLOCKED**. No existing activePage, navigation item, page, API, domain model, hierarchy data, organization-specific RBAC rule, or supported workflow exists. Resolution requires a separately approved product/backend feature before UX/UI implementation.

Data Synchronization and System Health do not have existing frontend routes or API contracts in this application. They remain **NOT APPLICABLE** rather than being represented with non-functional mock screens.

## Risks retained

- The application is currently a single frontend entry module; presentation components share its existing state and API calls.
- Visual review of authenticated pages requires an approved non-production account and must not capture employee data.
