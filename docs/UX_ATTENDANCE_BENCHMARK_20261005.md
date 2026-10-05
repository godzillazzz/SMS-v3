# SMS-v3 Attendance UX Benchmark & Wireframe Direction — 2026-10-05

## Objective

Benchmark the current SMS-v3 employee Attendance journey against strong contemporary HR/workforce products and award-recognized HR UX, then define the smallest next UX changes that improve clarity without weakening Attendance controls.

This is a UX/product-direction document. It authorizes no Production behavior or policy change by itself.

## Benchmarks reviewed

### Award-recognized HR experience

1. **Hailey — “HR in my pocket”, UX Design Awards 2025 Spring**
   - Mobile-first.
   - Key tools and insights are kept accessible without making the employee navigate the full HR system.
   - Jury emphasis: intuitive standard tasks, approachable language, focused experience.
   - Source: https://ux-design-awards.com/winners/2025-1-hr-in-my-pocket

2. **Sapien HR, UX Design Awards 2025 Autumn**
   - Designed explicitly for remote and desk-less workers.
   - Treats clock-in, leave, onboarding and other HR actions as moments in an employee lifecycle instead of disconnected forms.
   - Emphasizes guidance, personalization and consumer-grade mobile expectations.
   - Source: https://ux-design-awards.com/winners/2025-2-sapien-hr

3. **Workable HR — all-in-one employee management system, UX Design Awards 2025 Spring**
   - Unifies complex HR workflows while serving both HR operators and employee self-service.
   - Strong reference for reducing complexity without removing operational depth.
   - Source: https://ux-design-awards.com/winners/2025-1-an-all-in-one-employee-management-system

### Attendance / workforce products

4. **Connecteam Time Clock**
   - One-click mobile clock in/out.
   - Schedule-linked time clock, GPS/geofencing, real-time attendance visibility and digital timesheet flow.
   - Employee surface is task-first; payroll/management depth is downstream.
   - Sources:
     - https://connecteam.com/employee-time-clock-app/
     - https://connecteam.com/employee-time-clock-app/gps-tracking/

5. **UKG Ready / UKG Pro WFM**
   - Mobile punches can be constrained by work-location geofencing.
   - Employee self-service combines schedule/time/pay context.
   - Supervisor mobile view emphasizes who has or has not clocked in and location/job context.
   - Sources:
     - https://www.ukg.com/customers/environment-control
     - https://www.ukg.com/working-smarter-cafe/go-guide-geofencing-ukg-pro-wfm

6. **Deputy**
   - Attendance action, location validation and downstream timesheet/payroll visibility are presented as one workforce journey.
   - SMS-v3 should borrow the clear attendance/timesheet journey, not Deputy's facial-verification choice because Face is intentionally outside current G06.
   - Source: https://www.deputy.com/features/employee-time-clock

### Interaction principle

7. **Nielsen Norman Group — progressive disclosure / top-task-first**
   - Put the most common action and the minimum decision context first.
   - Reveal secondary operational detail after a tap rather than forcing all information into the primary screen.
   - Source: https://www.nngroup.com/articles/vanguard-mobile-app/

## What SMS-v3 already does well

The current Production Attendance screen has several strong foundations:

- one visually dominant clock-in/out action;
- expected schedule location and actual location are both visible;
- cross-site work is preserved rather than silently normalized;
- device state is visible;
- GPS/geofence and offline capability are visible before action;
- history is directly accessible;
- dark mobile styling has high contrast and large touch targets.

These are structurally compatible with the strongest workforce references.

## Main UX gaps

### P0 — replace internal rule vocabulary on the employee surface

Current: `ธงตรวจ: ASSIST_OTHER_SITE`.

Target employee language:
- **ช่วยปฏิบัติงานต่าง Site**
- secondary explanation: “ระบบบันทึก Site ที่ลงเวลาจริงไว้ และส่งรายการให้ตรวจตามนโยบาย”
- internal code `ASSIST_OTHER_SITE` moves behind “รายละเอียดทางเทคนิค”.

Reason: award-level HR products use human language for the primary journey; internal reason codes belong in audit/supervisor detail.

### P0 — convert the top of the screen into “Now / Next / Exception”

The employee should understand three things within one glance:

- **Now:** current shift and whether the user is currently clocked in;
- **Next:** exactly one primary action, CHECK_IN or CHECK_OUT;
- **Exception:** only if something requires attention, e.g. different Site, low GPS accuracy, late/offline sync.

The existing screen contains the right information but spreads it across multiple large cards before the primary action.

### P0 — add a post-action receipt

Immediately after a successful punch, show a compact receipt:

- “ลงเวลาออกสำเร็จ”
- server timestamp;
- actual Site;
- device status “เครื่องหลัก”;
- geofence result;
- sync status “บันทึกกับ Serverแล้ว” or “รอส่งเมื่อออนไลน์”;
- exception label if present.

This creates the same confidence pattern as payment/booking receipts and reduces repeated taps or support questions.

### P1 — humanize security/offline labels

Current employee-facing technical wording such as `AES-GCM encrypted queue` is implementation detail.

Recommended primary copy:
- **ออฟไลน์พร้อมใช้งาน**
- “ถ้าเน็ตหลุด ระบบเก็บรายการในเครื่องและส่งให้อัตโนมัติเมื่อออนไลน์”

Move encryption/queue detail into expandable technical information for support/audit users.

### P1 — make primary-device state affirmative

Current: “อุปกรณ์ / เครื่องหลัก”.

Target:
- “อุปกรณ์นี้ยืนยันแล้ว ✓”
- secondary text: “เครื่องหลักของคุณ”

The state should communicate “safe to continue” rather than merely naming the device category.

### P1 — separate employee action from supervisor review

Employee journey should not become a mini audit console. Employee sees a concise exception explanation; Supervisor/Admin receives the full reason code, evidence status and review queue.

This follows the Workable/Sapien pattern of role-appropriate complexity.

## Proposed employee wireframe

```
┌────────────────────────────────────┐
│ กะ D · 07:00–19:00                │
│ สถานะ: ทำงานอยู่ / ลงเวลาเข้าแล้ว │
│ Site ตามตาราง: วังน้อย             │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ ⚠ ช่วยปฏิบัติงานต่าง Site          │
│ พบตำแหน่งที่ Site BV#AN2          │
│ ระบบจะเก็บ Site จริงไว้เพื่อตรวจ   │
│ [ดูรายละเอียด]                     │
└────────────────────────────────────┘

        ┌────────────────────┐
        │     ลงเวลาออก      │
        │    กดครั้งเดียว     │
        └────────────────────┘

✓ ตำแหน่งพร้อม   ✓ อุปกรณ์นี้ยืนยันแล้ว
✓ Online          ✓ Server พร้อม

[ดูประวัติวันนี้]
```

After success:

```
┌────────────────────────────────────┐
│ ✓ ลงเวลาออกสำเร็จ                  │
│ 20:32 · บันทึกกับ Serverแล้ว       │
│ Site จริง: BV#AN2                  │
│ ช่วยปฏิบัติงานต่าง Site            │
│                                    │
│ [ดูประวัติวันนี้]   [เสร็จสิ้น]     │
└────────────────────────────────────┘
```

## Proposed supervisor journey

Supervisor home should prioritize an exception queue rather than raw records:

```
วันนี้
[ต้องตรวจ 3] [มาสาย 2] [ต่าง Site 1] [อุปกรณ์ผิด 0]

รายการต้องตรวจ
1. ช่วยปฏิบัติงานต่าง Site
   Expected: Site A
   Actual: Site B
   GPS: ผ่าน
   Device: เครื่องหลัก
   [เปิดหลักฐาน] [ยืนยัน] [ส่งกลับ]
```

Do not merge unrelated exceptions into one generic red state. Keep cause-specific evidence and allow drill-down.

## Recommended implementation order

1. **Attendance employee copy + hierarchy only** — no API/DB/policy change.
2. **Post-action receipt component** using already-returned attendance result.
3. **Supervisor exception wording/queue hierarchy** using existing flags.
4. **Offline state journey**: queued → syncing → synced → overdue/review.
5. Only after these are stable, consider broader Dashboard journey redesign.

## Acceptance criteria for the first UX PR

- no change to device-binding, offline, GPS/geofence or schedule authority;
- no change to Attendance API contract or DB schema;
- internal reason codes are hidden from the default employee surface but remain available to audit/supervisor flows;
- one primary attendance action remains dominant;
- successful attendance creates an explicit receipt state;
- cross-site attendance still preserves Expected and Actual Site;
- light/dark/mobile regression tests remain green;
- 390px mobile viewport remains first-class.

## Recommendation

The highest-value next implementation is **P0 Attendance Clarity**: humanize `ASSIST_OTHER_SITE`, restructure the screen around Now/Next/Exception, and add the post-action receipt. This improves the field-worker journey materially without touching the G06 security model.
