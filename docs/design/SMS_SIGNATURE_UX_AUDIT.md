# SMS Signature Experience V1 — UX/UI Audit

Baseline application SHA: `096e006580f95ff8fb2291312f3ba46be12cfe71`

Design direction: **Quiet Luxury Enterprise** — restrained violet/indigo brand anchor, flagship dark mode, premium airy light mode, mobile-first operational interaction, and frequent work in one or two meaningful actions where business/security rules allow.

## Executive findings

The current application already contains several strong primitives (ThemeControl, Personnel row-to-drawer, Access row-to-drawer, responsive Audit/Data Quality cards, dashboard partial-data semantics), but the product still feels assembled from multiple visual generations. The biggest experience issues are inconsistent headers/toolbars, dense nested cards, legacy inline emoji/chrome, page-specific table styling, mixed modal/drawer behavior, and frequent operational tables that still require small action buttons instead of row inspection.

Performance audit identifies a concrete backend serialization defect: `settleDashboardQueries()` awaits independent dashboard tasks one-by-one. This inflates route wall time even when the DB can safely execute a small number of independent queries concurrently. Frontend fetch effects are generally route-gated, but global employee/shift-type fetches and some count fetches run independently of the active surface and require review for duplicate or unnecessary work.

## Route inventory and target contract

| Route / Surface | Purpose | Primary role | Primary task | Current interaction path | Current meaningful actions | Target meaningful actions | Main issues / risks | Signature target |
| --- | --- | --- | --- | --- | ---: | ---: | --- | --- |
| Login | Authenticate / registration / recovery | All | Sign in | Login → credentials → submit | 1 | 1 | Form competes with decorative panel; theme should never affect form state | Quiet premium auth shell, dominant form, symmetrical shield retained, mobile decoration removed |
| Dashboard | Operational command center | All, role-aware | Find work requiring attention | Dashboard → scan many cards → choose module | 2–3 | 1–2 | Too many equal-weight cards; passive analytics compete with action required | Four key metrics max, Action Required first, Today Operations second, analytics lower |
| Personnel | Employee directory | Admin/Manager; Viewer read | Inspect / edit employee | Personnel → row → drawer → Edit | 2 | 2 | Good architecture; summary cards and chrome consume vertical space; mobile drawer must become sheet | Premium dense table, row is affordance, compact drawer/sheet, direct Edit primary |
| Access Management | Accounts / roles / status | Admin/Manager | Inspect / change account | Access → row → drawer → Edit/Approve | 2 | 2 | Existing row/drawer good; Edit sometimes hidden in row overflow; summary density high | Drawer primary action mirrors most likely role-appropriate action; compact status surface |
| Registration Review | Review private registration queue | Admin/Manager | Match and decide | Access → Registration Review → select request → candidate → Match → Approve/Reject | 3–5 | 2 decision steps after selecting | Decision context is fragmented; queue/context/action hierarchy can be clearer | Single decision workspace: queue / applicant / match context / decision |
| Leave Request | Submit leave | Viewer/Manager/Admin per rules | Submit request | Leave → long embedded form → submit | 1 | 1 | Form and history share same page; excessive emoji/chrome; loading can blank sections | Focused request panel; stale history retained; compact quota summary |
| Pending Leave Approval | Decide pending leave | Admin/Manager | Approve / reject | Pending → scan table → small Approve/Reject button | 1–2 | 2 max | No detail-first decision workspace; critical context compressed into row | Queue + selected request detail + decision controls; row tap/select is primary |
| Leave History | Review historical leave | Admin/Manager | Find / inspect / print | History → month control → row → print/action | 2–3 | 1–2 | Wide table on mobile; filters visually detached | Shared filter bar, row detail sheet on mobile, print secondary |
| Leave Quota | Provision / review annual quota | Admin | Review / edit / link | Quota → row → Edit/Link | 1–2 | 1–2 | Generic operational table does not expose record context on row click | Row drawer; Edit/Link visible only when relevant; legacy warning calm but explicit |
| Schedule | Monthly roster | All read; manager/admin edits | Edit employee/date/shift | Schedule → cell/row → editor / magic wand / save drafts | 2–4 | 1–2 for normal edit | Dense control strip; multiple modal paths; important actions compete | Calendar-first workspace; selected employee/date opens stable editor; batch draft actions grouped |
| Shift Configuration | Shift type administration | All read, Admin mutate | Inspect / remove shift types | Shift setup → table → action | 1–2 | 1–2 | Legacy table styling; destructive action visually loud | Shared data surface; row inspect; destructive remains confirmation-only |
| Licenses | License state + documents | Admin/Manager | Review license/document | Licenses → small Edit → modal → documents/history/review | 2–4 | 2 | Generic table; document workflow buried inside edit modal; dark table inconsistencies | Row → license drawer → primary Review/Upload; document history within same context |
| Audit Log | Compliance event review | Admin | Inspect event | Audit → row/card → preview | 1 | 1 | Strong responsive base but separate visual language | Shared signature table, compact filters, read-only detail drawer |
| Reports / Executive Report | Operational reporting | Admin/Manager | Review/export | Reports → tab/filter/export | 2–3 | 1–2 | Report surfaces visually isolated; passive data can dominate | Shared page header/filter shell; explicit export secondary utility |
| Data Quality | Data issue triage | Admin | Inspect issue / navigate target | Data Quality → row/card → target action | 1–2 | 1–2 | Good responsive semantics, but table/card visual treatment differs from other modules | Signature severity hierarchy, shared dark table, direct target action |
| Rules | Scheduling rules | All read; authorized mutate | Inspect / enable / edit | Rules → row → Edit/Toggle | 1–2 | 1–2 | Generic table action density; toggles lack detail context | Row drawer; Edit visible when frequent, toggle secondary |
| System Settings | Templates/settings | Admin | Inspect / save configuration | Settings → sections → edit/save | 1–2 | 1–2 | Legacy settings cards and dense borders | Calm configuration sections; single save locus per setting group |
| App Shell / Navigation | Move between modules | All, role-aware | Go to work | Sidebar → route | 1 | 1 | Too many visual layers; route sections can be quieter; mobile utility split | Compact grouped sidebar; mobile drawer; top Theme authoritative; no lower Theme |

## Explicit task-flow redesign

### Personnel edit
**Current:** Personnel → Row → Drawer → Edit → modal
**Target:** Personnel → Row → Drawer → **Edit mode / existing editor**. Two meaningful actions. Row click remains the universal inspect action.

### Personnel detail
**Current:** Personnel → Row → Drawer
**Target:** unchanged interaction count, redesigned drawer hierarchy and mobile full-height sheet.

### User role/status
**Current:** Access → Row → Drawer → Edit → save/confirm
**Target:** Access → Row → Drawer → **Edit account**. Role/status remain explicit and security-sensitive reductions/suspension retain confirmation.

### Registration review
**Current:** Access → registration section → applicant → candidate search → match → approve/reject
**Target:** Registration Review workspace → select applicant → match/decision from persistent context. No navigation away between evidence and action.

### License upload / review
**Current:** Licenses → Edit → license modal → document/history → review action
**Target:** Licenses → Row → License Drawer → Upload/Review. Two meaningful actions for the common path.

### Leave submission
**Current:** Leave → embedded submit panel → submit
**Target:** Leave → focused submission section → submit; supporting quota/history visually secondary. One meaningful submit action after data entry.

### Leave approval
**Current:** Pending → table row → Approve/Reject
**Target:** Pending → select request → decision panel → Approve/Reject. Two meaningful actions with context visible before decision.

### Schedule edit
**Current:** Schedule → row/cell/magic-wand path → modal/editor → draft → batch save
**Target:** Schedule → select employee/date/shift → stable editor; direct draft feedback; one grouped save action. Standard edit is <=2 actions, advanced auto-plan remains secondary.

### Quota review
**Current:** Quota → table → edit/link action
**Target:** Quota → row drawer → Edit/Link. Two actions with match state visible.

### Audit inspection
**Current:** Audit → row/card → preview
**Target:** unchanged one-action inspection, visually aligned with all other operational drawers.

## Top 10 baseline UX issues

1. Operational modules use different generations of page headers, cards, tables and action placement.
2. Dark tables can inherit light backgrounds from page-specific rules; there is no single authoritative table token contract.
3. Dashboard prioritizes quantity of widgets over the question “what needs attention today?”.
4. Generic operational tables force users toward small row action controls instead of making the row itself inspectable.
5. Leave and License workflows mix primary work, history and administration in dense legacy layouts.
6. Modal usage is inconsistent; some complex operational edits are modal-first while newer surfaces use drawers.
7. Legacy emoji/iconography and strong status-colored blocks create visual noise and reduce enterprise restraint.
8. Mobile often adapts via wrapping/hiding rather than using a deliberate full-height detail/action pattern.
9. Loading behavior varies by module; some surfaces replace content instead of retaining useful context.
10. Dashboard backend work is intentionally settled sequentially, amplifying DB/network latency across independent queries.

## Accessibility baseline concerns

- Preserve and extend row keyboard activation (`Enter` / `Space`) already present in Personnel and Access.
- Ensure all new drawers trap focus, restore trigger focus, close via ESC, and use `role="dialog"` / `aria-modal` where appropriate.
- Keep status meaning in text/iconography rather than color only.
- Mobile primary controls should approach 44px touch targets.
- Focus-visible styling must be consistent across sidebar, tables, drawers, filters and theme buttons.
- Row click must not steal button/menu events; nested interactive controls must stop propagation.

## Loading / empty / error target

- **First load:** skeleton shaped like the real surface.
- **Refresh:** keep stale data where safe; display subtle refresh state rather than blanking the whole page.
- **Empty:** explain whether no records, no search results, no pending work, or no permission.
- **Error:** distinguish permission, recoverable API/network, partial data and fatal state; provide contextual Retry/Clear/Back actions.

## Performance hypotheses to validate

1. `settleDashboardQueries()` serializes independent work — confirmed in baseline source.
2. Dashboard performs separate counts/fetches that can be grouped or executed with bounded concurrency.
3. Global employee and shift-type fetches currently load independent of the active page and may create unnecessary startup pressure.
4. Pending leave count is fetched separately from dashboard/leave data and may duplicate work for managers/admins.
5. List APIs request relatively large page sizes (`employees`, `licenses`, `leaveRequests`) and should be reviewed for payload size/N+1/includes before changing public contracts.
6. Login latency must be profiled around lifecycle synchronization, user lookup, bcrypt, session and audit; lifecycle correctness is non-negotiable.

## Acceptance contract

The implementation is accepted only if:

- Dark data surfaces are coherently navy with no accidental white tbody/rows.
- Light mode remains airy and premium, not a simple inversion.
- Frequent row inspection works by row click/tap and keyboard.
- Common Personnel, Access, Leave approval, License review and Schedule edit paths are <=2 meaningful actions where security semantics allow.
- The lower-left Sidebar Theme control remains absent; top Theme is authoritative and theme switching does not trigger business-data reload.
- Mobile 390×844 and ~375px widths have no page-level horizontal overflow.
- Dashboard independent backend work no longer executes strictly serially; concurrency remains bounded to avoid serverless pool pressure.
- Existing RBAC/business behavior is unchanged.
- Prisma schema/migrations remain unchanged unless separately approved.

## Implemented outcome — Signature Experience V1

### Interaction count after implementation

| Workflow | Before | After | Evidence |
| --- | ---: | ---: | --- |
| Personnel detail | 2–3 (name/action hunting) | 1 | Whole desktop row / mobile card opens detail; Enter/Space supported |
| Personnel edit | 3–4 | 2 | Row → Drawer → Edit; common Edit remains visible |
| Access account edit | 3 | 2 | Row → Drawer/Edit; Edit is visible rather than overflow-only |
| Registration review | 3–5 | 2 decision steps after selection | Queue + applicant + employee match context retained in one workspace |
| Leave approval | 2–3 with compressed table context | 2 | Select request → Approve/Reject in persistent queue/detail/decision workspace |
| License review | 3–4 | 2 | Row → operational drawer → Manage license/documents |
| Schedule normal edit | 2–4 | 2 for standard edit | Selection stays connected to the existing editor; advanced tools remain secondary |
| Audit inspection | 1 | 1 | Row/card remains direct inspection path with aligned data-surface language |

### Local visual QA evidence

- Widths 1440, 1280, 1024, 390 and 375 px: no page-level horizontal overflow after the Access mid-width containment correction.
- Personnel keyboard Enter opens detail; ESC closes; focus returns to the originating row.
- Operational license row supports Enter/Space to open the shared drawer.
- Personnel mobile: dense desktop table hidden; dedicated record cards shown; detail sheet measured 390 × 844 at x=0/y=0 after transition.
- Mobile visible buttons measured in the final Personnel detail flow: no action below 40 px height and primary actions use the 44 px contract.
- Theme Light → Dark → System generated zero business-data API requests; System followed emulated OS Dark and Light changes.
- Dark operational tables measured with navy rows/tds (`rgb(15,25,41)`) and navy headers (`rgb(17,29,47)`), including Personnel, Access, License and Audit. Schedule used the same dark row/header values.
- Light Personnel table measured off-white rows (`rgb(250,251,252)`) with cool header (`rgb(238,241,246)`).
- Browser evidence recorded no page errors, unresolved 5xx, or non-auth-refresh console failures during the screenshot pass.

### Local isolated performance evidence

Environment: Node 22 + disposable PostgreSQL 16 `sms_v3_test`, synthetic non-sensitive Signature fixtures. These measurements prove application architecture behavior; they are not a substitute for cloud Preview latency.

| Route | Cold | Warm samples (ms) | Warm median |
| --- | ---: | --- | ---: |
| Login | 135.94 ms | 34.36, 30.48, 56.01, 42.66, 44.83 | **42.66 ms** |
| Dashboard | 67.32 ms | 27.48, 21.92, 20.86, 29.16, 31.12 | **27.48 ms** |
| Employees | 26.54 ms | 10.32, 19.03, 24.24, 9.23, 9.03 | **10.32 ms** |
| Licenses | 20.09 ms | 13.59, 15.42, 14.97, 12.69, 10.84 | **13.59 ms** |
| Leave requests | 20.80 ms | 17.25, 10.98, 21.63, 11.67, 17.09 | **17.09 ms** |

Dashboard architecture changed from strict sequential settlement to a bounded worker pool with a maximum top-level concurrency of four. Nested aggregate fallback work remains serialized so deterministic instrumentation observes route-wide peak database pressure no higher than four. Partial-result semantics and stage timing logs are retained.

Login correctness was not reordered or weakened. Existing lifecycle throttling/in-flight coalescing remains authoritative; stage instrumentation now distinguishes lifecycle synchronization, user lookup, password verification, employee lifecycle synchronization and session creation.

### Database/index decision

No new Prisma model, field, relation, index or migration is required for this implementation. The confirmed dashboard bottleneck was application-level serialization and the changes remain migration-free. If Preview benchmarking later identifies a specific database/index bottleneck, that must be reviewed separately rather than introducing an unproven index in this cycle.
