# T19 Dashboard KPI / Action Deep-Link Mapping — Owner Proposal

**Status: PROPOSED — awaiting Owner approval.** This document records a source-backed mapping for review. No Business Navigation, route, API, metric, or filter contract has been changed.

**Reviewed baseline:** Integration `fix/serverless-database-reliability` at `e96ddd0942907c89ff3b964e05ce920d639b1814`; exact Integration CI [#38036179781](https://github.com/godzillazzz/SMS-v3/actions/runs/38036179781) is SUCCESS. The application code SHA is `451e667bf52541f9eba74383facbc5043c3936d2`; `e96ddd0` is the later docs-only #598 merge.

## Existing behavior and constraints

The Dashboard filter bar holds `date`, `month`, and (ADMIN only) `department` in React state. These filters are sent to `GET /api/v1/dashboard`, but are not represented in the URL. `DashboardNavigate` currently accepts only a page, and `main.tsx` navigates with `setActivePage(page)`. The route helper can accept query parameters, but dashboard links do not pass them and most destination pages do not hydrate their filters from query parameters.

The dashboard data is already server-scoped by the authenticated role. Managers and supervisors are department-scoped; only ADMIN may select a dashboard department. Any deep-link implementation must preserve that authorization scope and apply filters on the server **before pagination**. A client-side filter over one page must never be used to imply a complete count or result set.

The top `nexus-stream` action rows in `DashboardPage.tsx` are currently non-interactive display rows. The lower `AttentionNeededCard` rows and KPI/detail cards are clickable, but each currently passes only a destination page. Generic Work Queue and Quick Actions are module shortcuts, not metric filters.

## Recommended mapping

The values below preserve current dashboard metric definitions. Query names marked **proposed** require Owner approval and implementation; they are not claimed to be supported today.

| Metric / action key | Proposed destination and exact selector | Current support / required work |
|---|---|---|
| `activeEmployees` | `/app/employees?isActive=true&page=1&pageSize=100` plus the selected ADMIN `department`, if any | Backend `GET /employees` supports server-side `isActive`, `department`, page, and pageSize. The directory currently does not hydrate these filters from the route. Keep the server's `meta.total` as the authoritative count. |
| `totalEmployees` | `/app/employees?page=1&pageSize=100` plus the selected ADMIN `department`, if any | Same endpoint and server metadata; do not count rows from the current page. |
| `workingToday`, `totalScheduled`, `onDuty`, `noShift`, and each `byShift` group | `/app/roster?month={month}&date={date}&department={department}&workforce={SCHEDULED|ON_DUTY|NO_SHIFT}&shiftTypeCode={code}` | **Proposed server filters.** Current `GET /schedule-calendar` accepts month, department, page, and pageSize only. It needs exact-day/workforce/shift filters and a server-derived total before paging. Definitions: scheduled = distinct employees assigned that day; on-duty = scheduled distinct employees excluding those with an active leave overlapping the date; no-shift = active employees minus scheduled distinct employees. |
| `leaveToday` / `todayOperations.onLeave` | `/app/leave?date={date}&statusIn=PENDING,APPROVED&countBy=employee&department={department}` | **Proposed server filters.** Dashboard count is distinct employees whose active leave overlaps the selected day, not the number of leave requests. Current `GET /leave-requests` accepts status, department, year/month and other filters, but no exact-day overlap or distinct-employee selector. |
| `pendingLeaves` action (`leavePending`) | `/app/leave/approvals?status=PENDING&page=1&pageSize=100` with authenticated department scope | The backend leave list supports server-side `status` and pagination; the route/UI must initialize and pass the selector. This action counts pending request rows (not distinct employees) and is not bounded by the Dashboard's selected month. |
| Monthly leave `total/PENDING/APPROVED/REJECTED/CANCELLED` | `/app/leave/history?year={year}&month={month}&status={status}` | Backend leave-list filters already support year, month and status; month matching is request-date-range overlap. The UI reads month/year for Leave History, but does not initialize a status filter from the URL. |
| `licensePending`, `licenseReturned`, `licenseExpired` and license status rows | `/app/licenses?employeeStatus=ACTIVE&documentStatus={PENDING|RETURNED_FOR_CORRECTION|EXPIRED}&page=1&pageSize=100` | **Proposed document-status filter.** Current `GET /licenses` supports employeeStatus and employeeId only; document status must be filtered server-side before pagination. |
| `licenseExpiring`, `expiringWithin30`, `expiringWithin90`, `valid`, `expired` | `/app/licenses?documentStatus=APPROVED&isCurrent=true&expiryFrom={date}&expiryThrough={date+30}` (or +90 for the 31–90-day bucket) | **Proposed server filters.** Current action count uses approved/current documents with `proposedExpiryDate <= date+30` and has no lower bound, while the `expiringWithin30` overview bucket uses the inclusive range `[date,date+30]`. These definitions can disagree for already-expired-by-date documents. Recommendation: keep expired items in the separate expired bucket and use the forward-looking inclusive window for “within 30 days”; Owner must approve this semantic correction before implementation. |
| Each expiring-license detail row | `/app/licenses?employeeId={employeeId}&licenseId={licenseId}` | Backend accepts employeeId but not licenseId; the current page also ignores those query values. Add server-side identity filtering and page initialization; never rely on the first 100 detail rows as the complete aggregate. |
| `pendingUsers` action | `/app/users?accountStatus=PENDING&page=1&pageSize=100` | **Proposed query/pagination.** Current users endpoint has no query or pagination. It returns pending accounts for MANAGER/SUPERVISOR (server-scoped by department) and all accounts for ADMIN, so the same visible table does not mean the same exact filter for every role. |
| `unmatchedQuota` action | `/app/leave/quotas?matchStatus=UNMATCHED,DUPLICATE_UNMATCHED&year={year}&page=1&pageSize=100` | **Proposed server filter.** Current quota endpoint supports year, legacy, and employeeId only. Dashboard count is ADMIN-only and includes both unmatched statuses; apply the filter before pagination. |
| T05 pending-approval badge / `approvalCenter` action | `/app/approvals?type={ALL|LEAVE_REQUEST|SCHEDULE_APPROVAL|...}&page=1&pageSize=100` | T05 summary provides exact `byType` counts, but the list endpoint supports only `limit` (maximum 100); the page filters that loaded set in the client. Add a server-side type filter and pagination/cursor before linking a type-specific count. A generic “open all approvals” shortcut may remain unfiltered. |
| Work Queue steps and Quick Actions | `/app/roster`, `/app/employees`, `/app/approvals`, `/app/licenses` with no metric filter | These are general navigation shortcuts, not metric links. They should clear unrelated Dashboard-only query values instead of inheriting stale page/search filters. |

Example using a selected day/month: `/app/roster?month=2026-10&date=2026-10-10&workforce=ON_DUTY`. Example for a month status: `/app/leave/history?year=2026&month=10&status=APPROVED`. The roster example requires the proposed server-side selector; it must not be implemented as filtering a paginated month response in the browser.

## Owner decision requested

1. Approve the recommended policy: preserve the current server-defined metric meanings, pass the relevant Dashboard context into destinations, and add only server-side filters/counts before pagination.
2. Confirm that “people on leave today” remains a distinct-employee count, while “pending leaves” remains a leave-request count.
3. Approve the recommended “expiring within 30 days” range `[selected date, selected date + 30 days]`, with already expired licenses kept in the expired bucket. The current action count has no lower date bound.
4. Approve passing the selected date/month and an ADMIN-selected department to matching destinations. The backend must continue enforcing role-based department scope regardless of query values.
5. Approve adding server-side approval type filtering/pagination where a type badge is intended to deep-link to matching rows.

After this decision, reconcile only the dashboard and destination code needed for the accepted mapping. Re-run exact-head backend/frontend tests, build, security checks, browser regression, CI, and Preview. Do not mark T19 accepted from a documentation change or CI alone.
