# SMSv3 — แผนแก้ UX/UI สำหรับ Codex (ผูกกับโค้ดจริง)

> **สำเนาใน repo** (ต้นฉบับของเจ้าของระบบอยู่ที่ `C:\Users\sermp\Downloads\sms-v3-codex-fix-plan.md`) — ภาพและโลโก้อ้างอิงอยู่ในโฟลเดอร์เดียวกับไฟล์นี้ (`docs/ux-remediation/`)

> **ที่มา:** รีวิว `https://sms-v3-staging-ten.vercel.app/` ด้วยบัญชี ADMIN เมื่อ 6 ต.ค. 2569 แล้วไล่หาตำแหน่งในโค้ด
> ⚠️ **โดเมนนี้คือระบบ Production ที่ใช้งานจริง** (ชื่อมีคำว่า staging แต่ `VERCEL_ENV=production`) — ห้ามเขียน/ลบข้อมูลเพื่อทดสอบ
> **โค้ดที่ใช้อ้างอิง (ตอนเขียนแผนครั้งแรก):** branch `fix/serverless-database-reliability` @ `f63c785e8af1`
> ⚠️ `main` ตามหลัง branch นี้มาก — **ห้ามให้ Codex เริ่มงานจาก `main`**
> **หมายเหตุ:** เลขบรรทัดอ้างอิงจาก commit ตอนเขียน ถ้าโค้ดขยับไปแล้วให้ค้นด้วยข้อความที่ระบุไว้แทน
> **อัปเดตล่าสุด:** 7 ต.ค. 2569

---

## สถานะปัจจุบัน (อ่านก่อนทุกครั้ง)

### ปล่อยขึ้น Production แล้ว
| รอบ | เนื้อหา | Release SHA | Production run |
|---|---|---|---|
| R1 | T04/T04b, T05, T21, T22, T23, sharp 0.35.5 | `31b17868` | 37561130901 |
| R2 | T01, T02, T03, T06 | `2d9a21c9` | 37572338555 |
| R3 | T24 (บางส่วน), T25, T26, T27, T28 + fallback navigator.locks | `b3e70834` | 37583167763 ← **Production ปัจจุบัน** |

### merge เข้า integration แล้ว แต่ยังไม่ปล่อย (จะไปกับ R4)
- T29 การพิมพ์ (#497) — ผ่านรีวิว
- T07 Inbox อนุมัติรวม (#499) — ผ่านรีวิว (⚠️ merge ตอน check ล่าสุดแดงเพราะ flaky — ดูกติกากระบวนการข้อ 2)
- T08 บันทึก blocker (#500) — เจ้าของระบบตัดสินแล้ว ดูหัวข้อ T08

### ลำดับงานที่เหลือ (ห้ามข้ามลำดับ)
1. **งานกระบวนการ (ทำก่อน):** รวม handoff เป็นไฟล์เดียว + ทำ CI check ที่ flaky ให้เสถียร (ดูกติกากระบวนการ)
2. **T08** แบบไม่มี diff ตารางกะ (ตามการตัดสินใจด้านล่าง)
3. **R4:** T30a → **T32** → **T33** → T30b (4 กลุ่ม + T15) → T16 → T17 → T10 → T13 → T11 → T12 → T31 → หยุดรอเจ้าของระบบรัน Technical Smoke
4. **R5 (เริ่มหลังเจ้าของระบบแจ้ง "R4 ผ่าน" เท่านั้น):** T09 → T14 → T19 (T20 Playwright E2E: เขียนข้อเสนอเท่านั้น)
5. **ยังไม่อยู่ในรอบใด:** T18/T24 ส่วนที่เหลือ (readiness, dashboard, ตรวจ region ของ DB — ต้องให้เจ้าของระบบตัดสินเรื่อง infra)

### การตัดสินใจของเจ้าของระบบ (ห้ามเปลี่ยนเอง)
| เรื่อง | การตัดสินใจ |
|---|---|
| พนักงานที่มีหลายแผนก (เช่น "AN1,AN2,AN3") | คงพฤติกรรมปัจจุบัน (T21) |
| T08 diff ของตารางกะ | **ไม่ทำในตอนนี้** — ห้ามเพิ่ม schema / ห้ามเดา diff จาก audit (ดู T08) |
| T29 ใบลา | ต้องเหมือนภาพ `sms-v3-leave-print-reference.png` 1 หน้า A4 แนวตั้ง |
| T30 รูปแบบหน้า | ใช้โครง Dashboard ทุกหน้า, การ์ดมน 16px / ย่อย 10px, padding 24/16px, พื้นหลังสีเดียว, ทั้งธีมสว่างและมืด |
| T31 ใบลงเวลา | ตัด OT และเบี้ยเลี้ยง/ค่าพาหนะ/ค่าเดินทาง/ค่าตำแหน่ง, พิมพ์ได้เฉพาะ "Manager ขึ้นไป" = รหัส `ADMIN` + `SUPERVISOR`, ใช้โลโก้ระบบ |
| บัญชี "Sermpong UAT" | เก็บไว้ก่อน (ยังไม่ระงับ) |
| รปภ. ใช้ระบบลงเวลาจริง | ยังไม่เปิดใช้ (ณ 7 ต.ค. 2569) |
| T32 หน้าจอโหลด | ใช้ `sms-v3-loading-logo.webp` (พื้นสว่าง) / `sms-v3-loading-logo-dark.webp` (พื้นเข้ม) |
| T33 โลโก้มุมซ้ายบน | ใช้ `sms-v3-logo-horizontal.webp` / `-dark.webp` แทนตัวหนังสือ **รวมหน้า Login และหน้าสาธารณะ** |

### กติกากระบวนการ (เพิ่มจากบทเรียนรอบที่ผ่านมา)
1. **handoff ไฟล์เดียว:** เขียนสถานะที่ `MASTER_HANDOFF.md` เท่านั้น — ย้ายเนื้อหาล่าสุดจากไฟล์ `MASTER HANDOFF.md` (มีเว้นวรรค, มีสถานะ T07/T08) เข้าไฟล์หลัก แล้วลบไฟล์ที่มีเว้นวรรค
2. **ห้าม merge เมื่อ check ล่าสุดของ head SHA แดง** — `scripts/ci/verify-preview-runtime.js` (เพิ่มใน #497) ล้มเป็นบางครั้งด้วย `PREVIEW_RUNTIME_FAILED=fetch failed` → ต้องมี retry 3 ครั้ง + timeout ชัดเจน หรือย้ายเป็นขั้นที่ไม่บล็อก
3. **อัปเดต PR ด้วย update-branch แบบ merge** ห้าม rebase/force-push (rebase PR ที่ push แล้วต้อง force-push)
4. **1 Task = 1 branch = 1 PR** merge ด้วย `--delete-branch` และ `git worktree remove` หลัง merge
5. **บทบาทในโค้ดสลับกับที่แสดง:** `SUPERVISOR` แสดงว่า "Manager", `MANAGER` แสดงว่า "Supervisor" (`role-display.ts`) — ระวังทุกงานที่เกี่ยวกับสิทธิ์
6. **Codex dispatch workflow ไม่ได้:** หยุดที่ "พร้อมให้เจ้าของระบบรัน Technical Smoke: RELEASE_SHA=…" แล้วรอ — เจ้าของระบบหาค่า Preview/dpl id และกดรันเอง จากนั้น Codex ทำ release-control PR (แบบ #496) แล้วหยุดรอให้เจ้าของระบบรัน Production workflow

---

## 0. คำสั่งเปิดงาน (แปะทุกครั้ง)

```
งาน: แก้ UX/UI ของ SMSv3 ตาม Task ด้านล่าง

ขอบเขตและการปล่อยงาน:
- สร้าง worktree ใหม่ใต้ .worktrees/ จาก origin/fix/serverless-database-reliability (ถ้าทีมย้าย integration branch แล้วให้ใช้ branch ล่าสุดที่ staging ใช้ และแจ้งว่าใช้ SHA อะไร)
- จบงานที่: commit + push branch ใหม่ + เปิด PR + Vercel Preview READY + รายงานผล
- งานนี้ "ไม่ได้" อนุมัติให้ deploy Production, promote, หรือแตะ Environment approval — หยุดที่ Preview
- ห้ามแก้ข้อมูลธุรกิจ (พนักงาน/ตาราง/ลงเวลา/ลา) บน Production หรือ staging เพื่อทดสอบ UI

กติกาการแก้:
1. อ่าน AGENTS.md และ MASTER_HANDOFF.md (ถ้ามี) ก่อน
2. ใช้ข้อความ UI / path / เลขบรรทัดใน Task เพื่อหาโค้ด ถ้าเลขบรรทัดเลื่อนให้ค้นด้วยข้อความ
3. แก้เฉพาะขอบเขต Task ห้าม refactor ส่วนอื่น ห้ามเพิ่ม dependency ถ้า Task ไม่ได้ระบุ
4. ห้ามเปลี่ยน API contract, RBAC, auth policy, schema/migration เว้นแต่ Task ระบุชัด
5. ข้อความที่ผู้ใช้เห็นเป็นภาษาไทย (ศัพท์ที่ผู้ใช้หน้างานรู้จักใช้อังกฤษได้ เช่น QR, GPS, Passkey)
6. repo มี source-contract test ที่ล็อกข้อความ UI ไว้ (เช่น frontend/src/*.test.ts) — ถ้า Task เปลี่ยนข้อความ ให้แก้ test ให้ตรง requirement ใหม่ ห้ามลบ test ทิ้ง
7. ตรวจ: npm --prefix frontend test, npm --prefix frontend run build, npm test (ถ้าแตะ backend), git diff --check
8. UI: ตรวจในเบราว์เซอร์จริงที่ 1366×768 และ 375×812 ตาม AGENTS.md ข้อ 4
9. รายงานท้ายงาน: ไฟล์ที่แก้, ผล test/build, Preview URL, Acceptance criteria แต่ละข้อ ผ่าน/ไม่ผ่าน/ยังไม่ได้ตรวจ (บอกตามจริง)
```

---

## ภาพรวม Tasks

| Task | เรื่อง | สถานะ (7 ต.ค. 2569) |
|---|---|---|
| T01 | ตัวเลข 0 / ค้างข้ามหน้า ตอนโหลด | ✅ Production (R2) |
| T02 | หน้าลงเวลาอ่านไม่ออก + เหตุผลที่กดไม่ได้ | ✅ Production (R2) |
| T03 | ลบข้อความนักพัฒนา / ของยังไม่เสร็จ | ✅ Production (R2) |
| T04 / T04b | อนุมัติตารางกะ: state guard | ✅ Production (R1) |
| T05 | ตัวนับอนุมัติรวมตารางกะ | ✅ Production (R1) |
| T06 | หน้า Login | ✅ Production (R2) |
| T07 | Inbox อนุมัติรวม | 🟡 merge แล้ว (#499) รอ R4 |
| T08 | หน้ารายละเอียดอนุมัติมาตรฐาน | ⏳ ทำต่อแบบไม่มี diff ตารางกะ |
| T09 | URL ทุกหน้า | ⬜ R5 |
| T10 | ข้อมูลพนักงาน: ย่อ Readiness | ⬜ R4 |
| T11 | ตารางกะรายเดือน | ⬜ R4 |
| T12 | ตั้งค่าระบบแบ่งหมวด | ⬜ R4 |
| T13 | ฟอร์มยื่นลา | ⬜ R4 |
| T14 | Onboarding checklist | ⬜ R5 |
| T15 | ภาษา/ชื่อหน้า | ⬜ R4 (ทำพร้อม T30b) |
| T16 | วันที่และเวลา | ⬜ R4 |
| T17 | Accessibility | ⬜ R4 |
| T18 / T24 | ความเร็ว API | 🟡 บางส่วนใน R3 (supervisor/daily 35→26.5 s, poll หยุดเมื่อแท็บซ่อน) — ที่เหลือยังไม่อยู่ในรอบใด |
| T19 | Dashboard | ⬜ R5 |
| T20 | E2E tests | ⬜ R5 (ข้อเสนอเท่านั้น) |
| T21 | เรียงตามแผนก → รหัสพนักงาน | ✅ Production (R1) |
| T22 | บันทึกได้ 1,000 กะ | ✅ Production (R1) — เกณฑ์ 15 วินาทียังไม่ได้วัด |
| T23 | จัดกะอัตโนมัติไม่ทับกะเดิม | ✅ Production (R1) |
| T25 | token reuse (single-flight + fallback) | ✅ Production (R3) — audit บัญชี UAT ยังไม่ได้ตรวจ |
| T26–T28 | ป้ายไทย / คิวอนุมัติ / เก็บตกข้อความ | ✅ Production (R3) |
| T29 | การพิมพ์ A4 (ใบลา) | 🟡 merge แล้ว (#497) รอ R4 |
| T30 | โครงทุกหน้าแบบ Dashboard + ธีมมืด | ⬜ R4 (งานหลัก) |
| T31 | ใบลงเวลาประจำเดือน | ⬜ R4 (หลัง T12) |
| T32 | หน้าจอกำลังโหลดด้วยโลโก้ SMS | ⬜ R4 (หลัง T30a) |
| T33 | โลโก้แนวนอนมุมซ้ายบน (แทนตัวหนังสือ) | ⬜ R4 (หลัง T32) |

---

# P0 — พร้อมเดโม

## T01 — ห้ามแสดง "0" ตอนโหลด และห้ามข้อมูลค้างข้ามหน้า

**อาการ**
- ระหว่างโหลดแสดง `0` เช่น ข้อมูลพนักงาน "ทั้งหมด 0 คน" / "โปรไฟล์ไม่สมบูรณ์ 0 · ข้อมูลครบถ้วน", คำขอลา "0/0/0", ใบอนุญาต "ทั้งหมด 0 รายการ", อนุมัติตารางกะ "ทั้งหมด 0 รายการ"
- เปิด "คุณภาพข้อมูล" ต่อจาก "บันทึกการใช้งานระบบ" เห็น `3,933 รายการ` / `หน้า 1 จาก 158` (ของ Audit) ก่อนเปลี่ยนเป็น `9 รายการ`
- ประวัติการลา: "กำลังดึงประวัติการลา…" พร้อม "ทั้งหมด 81 รายการ"

**สาเหตุที่พบในโค้ด**
- `frontend/src/main.tsx:1673` — `operationResponse` เป็น state เดียวใช้ร่วมทุกหน้า
- `frontend/src/main.tsx:2000` — reset `setOperationResponse({})` อยู่ใน `useEffect` (ทำงานหลัง render แรกของหน้าใหม่) และ **ยกเว้น `leaveHistory`** จึงเห็นค่าของหน้าเก่า
- `frontend/src/main.tsx:2651` — `DataQualityCenterPage` รับ `total={operationResponse.meta?.total ?? …}` จาก state ร่วมนี้

**สิ่งที่ต้องทำ**
1. ผูก response กับหน้าที่ร้องขอ เช่นเก็บเป็น `{ page: Page; key: string; response: DataResponse }` และเวลา render ให้ใช้ response **เฉพาะเมื่อ `page === activePage`** (และ key ตรงกับ filter ปัจจุบัน) ไม่งั้นถือว่า loading
2. ลบข้อยกเว้น `leaveHistory` ที่บรรทัด 2000 (หรือทำให้ข้อ 1 ครอบคลุม)
3. ตัวเลขสรุป / "ทั้งหมด N รายการ" / pagination / คำบรรยายใต้ตัวเลข: ถ้า loading ให้แสดง skeleton หรือ "—" ห้ามแสดง 0 — ตรวจ component เหล่านี้:
   - `frontend/src/pages/personnel/PersonnelDirectoryPage.tsx`, `components/personnel/PersonnelMetricCard.tsx`
   - หัวหน้า licenses / quota / approvals ใน `OperationalTable` (`main.tsx:927` เป็นต้นไป) และ `record-chip`
   - `LeaveManagementPage` (render ที่ `main.tsx:2956`)
   - `pages/data-quality/DataQualityCenterPage.tsx`
4. ใช้ `DataTableState` ที่มีอยู่ (`variant="empty" | "error"`) ให้ครบ 3 สถานะ loading / empty / error

**Acceptance criteria**
- [ ] DevTools → Slow 3G: ทุกหน้าในเมนูไม่มี `0` ระหว่างโหลด
- [ ] สลับ บันทึกการใช้งาน → คุณภาพข้อมูล → ข้อมูลพนักงาน → ประวัติการลา: ไม่มีตัวเลขจากหน้าก่อนโผล่แม้ 1 frame
- [ ] เพิ่ม test: render หน้า B ทันทีหลังหน้า A โดย response ของ B ยังไม่มา → ต้องไม่แสดง total ของ A

---

## T02 — หน้าลงเวลา (SMS TIME) อ่านไม่ออก

**อาการ** (เมนู "ลงเวลา" ใน shell ปกติ ไม่ใช่ PWA)
- panel พื้น `#06131f` แต่ชื่อผู้ใช้ (`h1`), "กำลังเตรียมระบบลงเวลา", "ลงเวลาเข้า" ในการ์ด "ขั้นตอนถัดไป", และกล่องสถานะ danger เป็นตัวสีเข้ม (computed contrast ≈ 1.1:1)
- ปุ่มวงกลม "ลงเวลาเข้า" `disabled` แต่เหตุผลอ่านไม่ได้
- 375×812: ปุ่ม top ≈ 570px สูง 293px → ล้นจอล่าง

**ไฟล์**
- `frontend/src/pages/attendance-simple/AttendanceSimplePage.tsx` (header ~บรรทัด 431, journey ~441, status ~463)
- `frontend/src/pages/attendance-simple/attendance-simple.css` (บรรทัด 1–34: panel ตั้ง `color:#e8f0f8` แต่ `h1`/`strong` ถูก global typography ของ shell ทับ)
- `frontend/src/pages/attendance-simple/attendance-simple-client.ts:96–104` (map error code → ข้อความ)
- test ที่มีอยู่: `frontend/src/attendance-mobile-contrast.test.ts`, `attendance-simple-p0-clarity.test.ts`

**สิ่งที่ต้องทำ**
1. เปิดหน้าในเบราว์เซอร์ (shell ปกติ ธีมสว่าง) ตรวจ computed `color` ของ `.attendance-simple__header h1`, `.attendance-simple__journey strong`, `.attendance-simple__status strong` หา selector global ที่ทับ แล้วกำหนดสีใน `attendance-simple.css` ให้ชนะ (scope ด้วย `.attendance-simple …` ไม่ใช้ `!important` ถ้าเลี่ยงได้)
2. `.attendance-simple__status.is-danger/.is-warning/.is-success`: ข้อความต้อง contrast ≥ 4.5:1 กับพื้นของแต่ละ tone
3. `attendance-simple-client.ts:102-103`: ห้าม fallback ไปที่ `error.message` / `responseBody.message` ดิบ (เป็นอังกฤษ) — ให้ map code ที่ยังไม่ครอบคลุม (ดู code ที่ backend ส่งจริงใน `src/` เช่น device ยังไม่ลงทะเบียน / รออนุมัติ / ไม่มีบัญชีพนักงาน) และ fallback เป็น "ไม่สามารถลงเวลาได้ กรุณาลองใหม่หรือติดต่อหัวหน้างาน" + requestId ในส่วนพับเก็บ (ใช้ `request-error.tsx` ที่มีอยู่)
4. เมื่อปุ่มลงเวลา disabled: แสดงเหตุผลใต้ปุ่ม + ปุ่มพาไปทำต่อ (เช่น "ลงทะเบียนเครื่องนี้" → `attendanceDevice`) และใส่ `aria-describedby`
5. มือถือ ≤ 700px สูง: ลดขนาดปุ่ม / ย้าย `.attendance-simple__assurance` ลงใต้ปุ่ม ให้ปุ่มอยู่ในจอแรก
6. ห้ามแตะ logic GPS / device proof / offline queue

**Acceptance criteria**
- [ ] axe ไม่มี color-contrast ใน `.attendance-simple` ทั้งธีมสว่างและมืด, shell ปกติและ PWA
- [ ] ทุกกรณีปุ่ม disabled มีเหตุผลภาษาไทย + ทางไปต่อ
- [ ] 375×667 เห็นปุ่มลงเวลาครบโดยไม่เลื่อน

---

## T03 — ลบข้อความนักพัฒนาและส่วนที่ยังไม่เสร็จ

| ข้อความ | ไฟล์:บรรทัด | ให้ทำ |
|---|---|---|
| `AWAITING TELEMETRY` (การ์ด SLA / Auto-verified) | `pages/approvals/ApprovalCenterPage.tsx:465, 471, 479` (+ state 197/237/265) | ซ่อนการ์ดที่ไม่มีข้อมูล; ตอนโหลดใช้ skeleton |
| `AWAITING TELEMETRY` ×4, `MATRIX CALIBRATION`, `No calibration channel in backend` | `components/SecuritySiteManagementPanel.tsx:409–412` | loading → skeleton; ลบการ์ด MATRIX CALIBRATION |
| `CHECKPOINT CHANNEL NOT CONFIGURED`, `RTK telemetry` | `components/SecuritySiteManagementPanel.tsx` (ค้นข้อความ) | ซ่อน |
| `AWAITING TELEMETRY` (Integrity / Critical / Immutable) | `components/audit/AuditSummaryGrid.tsx:3` | ซ่อนการ์ดที่ไม่มีข้อมูล |
| `Operational Coverage` + `GIS CHANNEL` (แผนที่ว่าง) | `pages/dashboard/DashboardPage.tsx:60` | ซ่อนทั้ง panel จนกว่าจะมีพิกัด |
| `server authority; client มีหน้าที่แสดงผลเท่านั้น` | `components/personnel/AttendanceReadinessCenter.tsx:10` | ลบ |
| `ตรวจสอบกฎเดิมกับตารางกะจาก PostgreSQL แบบ read-only` | `main.tsx:2983` | → "ตรวจตารางกะกับกฎการทำงาน" |
| `การไม่อนุมัติยังใช้ขั้นตอนและ validation เดิม… backend behavior` | `main.tsx:1587` | ลบ |
| `ศูนย์ควบคุมคำขอ… โดยคง Workflow, API และ Permission เดิม` | `ApprovalCenterPage.tsx` ใกล้ `:497` | ตัดท่อนหลัง |
| `Shared Pattern Engine…ไม้กายสิทธิ์…` | `main.tsx:2822–2823` | ลบทั้ง `<div>` |
| `P-256`, `non-exportable`, `possession`, `candidate`, `cryptographic proof`, `ไม่ใช่ Trusted Identity` | `pages/attendance-device/AttendanceDevicePage.tsx:423` และข้อความรอบ ๆ | เขียนใหม่: "ระบบจะผูกบัญชีของคุณกับเครื่องนี้อย่างปลอดภัย และต้องรอผู้ดูแลอนุมัติ" (**อย่าแก้** `lib/attendance-device-key*.ts`) |
| `G06 Preview UAT Fixture` (section) | `pages/access-management/G06UatProvisioningPanel.tsx:54`, render ที่ `AccessManagementPage.tsx:208` | render เฉพาะเมื่อ env เป็น preview **และ** มี flag เปิด; production ไม่ render เลย |
| `G06 · PERSONAL DEVICE`, `CFG-08 · ADMIN`, `SMS NEXUS / … / …` kicker | ค้น `rg "SMS NEXUS /\|G06 ·\|CFG-0"` ใน `frontend/src` (ไม่รวม test) | ลบรหัสภายใน; kicker เปลี่ยนเป็นชื่อหมวดภาษาไทยหรือเอาออก |
| `Google Sheets ถูกยกเลิก` (ปุ่ม) | `main.tsx:1117` | ลบปุ่ม |
| `A linked employee account is required` + `รหัสอ้างอิง` | ข้อความมาจาก backend แสดงใน `AttendanceDevicePage.tsx` | map เป็น "บัญชีนี้ยังไม่ได้ผูกกับข้อมูลพนักงาน กรุณาติดต่อผู้ดูแลระบบ"; รหัสอ้างอิงไปไว้ใน "รายละเอียดสำหรับผู้ดูแล" (ดู `request-error.tsx`); **ปิดฟอร์ม "ลงทะเบียนอุปกรณ์เครื่องแรก"** เมื่อเกิดกรณีนี้ |
| ตัวกรอง `Secure Vault Access`, `Shift Swap` | `ApprovalCenterPage.tsx` (ค้นข้อความ) | ซ่อนประเภทที่ backend ไม่มีจริง (ดู type ใน `src/services/approval-center.service.js:342–486`) |
| `Environment: production` บน staging | `pages/system-health/SystemHealthPage.tsx:182` และ backend ที่ส่งค่า | แสดง `VERCEL_ENV` (preview/production) แทน `NODE_ENV` — ถ้าต้องแก้ backend ให้แก้เฉพาะ field ที่ส่งออก |

**หมายเหตุข้อมูล (ไม่ต้องแก้โค้ด):** มี revision ตาราง ต.ค. ที่หมายเหตุ "Owner-authorized G06 UAT…" — แจ้งเจ้าของระบบให้ตัดสินใจเรื่องข้อมูลทดสอบบน staging ก่อนเดโม

**Acceptance criteria**
- [ ] `rg "AWAITING TELEMETRY|server authority|PostgreSQL แบบ|backend behavior|Shared Pattern Engine|Google Sheets ถูกยกเลิก" frontend/src --glob '!*.test.*'` → ไม่พบ (หรือเหลือเฉพาะหลัง flag พร้อมเหตุผล)
- [ ] production build ไม่ render G06 UAT Fixture
- [ ] test ที่ล็อกข้อความเหล่านี้ (`approval-center-v1`, `g06-attendance-workflow-ux`, `wave4-operational-data-surfaces`, `vf02-visual-fidelity`, `attendance-readiness-center`, `attendance-readiness-blocked-hotfix`, `rule-checking-data-surfaces`) ถูกแก้ให้ตรง requirement ใหม่และผ่าน

---

## T04 — 🔴 อนุมัติตารางกะ: ต้องมี state guard (backend + frontend)

**อาการ** หน้า "อนุมัติตารางกะ" (เปิดจากปุ่ม "ประวัติการอนุมัติ" ในตารางกะรายเดือน)
- ปุ่ม "อนุมัติ / ไม่อนุมัติ" แสดงและกดได้ในทุกแถว รวมแถว `APPROVED`
- revision เก่าค้าง `PENDING` (ส.ค. rev 6–11 ยัง PENDING ขณะ rev 19 APPROVED)
- สถานะ/ประเภทแสดง enum ดิบ (`PENDING`/`Pending`, `BATCH_UPDATE_SHIFT` …)

**สาเหตุที่พบในโค้ด**
- **Backend** `src/routes/operations.routes.js:782–806` (`PUT /schedule-approvals/:id`):
  - ไม่ตรวจสถานะเดิม → ADMIN ส่ง `REJECTED` ให้แถวที่ `APPROVED` แล้วได้ และโค้ดจะล้าง `approvedAt`/`approvedByLegacyRef` ทิ้ง (บรรทัด 793) = **ย้อนการอนุมัติตารางที่ใช้งานอยู่โดยไม่ตั้งใจได้**
  - `APPROVED` เรียก `approveMonthlySchedule(tx, { month })` (`src/services/schedule.service.js:363`) ซึ่งอนุมัติ **revision ล่าสุดของเดือน** ไม่ใช่แถวที่ผู้ใช้กด → กดอนุมัติที่ revision เก่า = อนุมัติ revision ใหม่ล่าสุดโดยผู้ใช้ไม่เห็น
  - `approvalNote` ไม่บังคับตอน `REJECTED`
- **Frontend** `frontend/src/main.tsx:948` แสดงปุ่มทุกแถวไม่ดู `row.status`; drawer `main.tsx:1001–1003` เช่นกัน; คอลัมน์ที่ `main.tsx:893–896` ใช้ `text(row.status)` / `text(row.changeType)` ดิบ

**สิ่งที่ต้องทำ — Backend** (`src/routes/operations.routes.js`)
1. ใน transaction หลังอ่าน `before`:
   - ถ้า `input.status` เป็น `APPROVED` หรือ `REJECTED` และ `before.status !== 'PENDING'` → `HttpError(409, …, { code: 'SCHEDULE_APPROVAL_INVALID_STATE' })`
   - ถ้า `before` ไม่ใช่ revision ล่าสุดของเดือน (มี revision ที่ `revision` สูงกว่าในเดือนเดียวกัน) → `HttpError(409, …, { code: 'SCHEDULE_APPROVAL_SUPERSEDED' })`
   - `REJECTED` ต้องมี `approvalNote` ไม่ว่าง (≥ 5 ตัวอักษร) → ไม่งั้น 400 `SCHEDULE_REJECTION_REASON_REQUIRED`
2. เขียน audit เหมือนเดิม; ห้ามเปลี่ยน RBAC เดิม (SUPERVISOR อนุมัติได้อย่างเดียว)
3. **ห้าม** แก้ข้อมูล revision เก่าที่ค้างอยู่ด้วย migration/script ใน Task นี้ — ให้ frontend แสดงเป็น "ถูกแทนที่" (ข้อ 5) และเสนอแนวทาง cleanup แยกในรายงาน
4. เพิ่ม test ใน `test/` ครอบ 4 กรณี: approve PENDING ล่าสุด ✓ / reject APPROVED ✗409 / approve revision เก่า ✗409 / reject ไม่มีเหตุผล ✗400

**สิ่งที่ต้องทำ — Frontend**
5. `main.tsx:948` และ `1001–1003`: แสดงปุ่มตัดสินใจเฉพาะ `status === 'PENDING'` **และ** เป็น revision ล่าสุดของเดือนนั้นในรายการ; แถว PENDING ที่ไม่ใช่ล่าสุด → ป้าย "ถูกแทนที่" (เทา) ไม่มีปุ่ม
6. "ไม่อนุมัติ" → dialog บังคับกรอกเหตุผล (ใช้ `useActionDialog` / pattern จาก `components/LeaveDecisionConfirmation.tsx`) แล้วส่ง `approvalNote`
7. สร้าง map กลาง (เช่น `frontend/src/approval-display.ts`) ใช้ทุกหน้าที่แสดงสถานะ/ประเภทอนุมัติ:
   - สถานะ (normalize ตัวพิมพ์ก่อน): `PENDING` "รออนุมัติ" · `APPROVED` "อนุมัติแล้ว" · `REJECTED` "ไม่อนุมัติ" · `DRAFT` "ฉบับร่าง" · `CANCELLED` "ยกเลิก" · superseded "ถูกแทนที่"
   - ประเภท: `BATCH_UPDATE_SHIFT` "แก้ไขกะหลายรายการ" · `AUTO_SCHEDULE_EMPLOYEE` "จัดกะอัตโนมัติ" · `LICENSE_RECONCILIATION` "ปรับตามใบอนุญาต" · `PRODUCTION_SHIFT_TIME_NORMALIZATION` "ปรับรูปแบบเวลากะ" · ไม่รู้จัก → "อื่น ๆ"
   - ใช้กับคอลัมน์ `main.tsx:893–896` และ `semanticStatusTone`
8. map error `SCHEDULE_APPROVAL_INVALID_STATE` / `SCHEDULE_APPROVAL_SUPERSEDED` / `SCHEDULE_REJECTION_REASON_REQUIRED` เป็นข้อความไทย

**Acceptance criteria**
- [ ] เรียก API ตรง ๆ: reject แถว APPROVED → 409 และข้อมูลไม่เปลี่ยน
- [ ] UI: แถว APPROVED / REJECTED / ถูกแทนที่ ไม่มีปุ่ม
- [ ] ไม่อนุมัติโดยไม่ใส่เหตุผลไม่ได้ (ทั้ง UI และ API)
- [ ] ไม่มี enum อังกฤษดิบในหน้าอนุมัติตารางกะ

---

## T05 — 🔴 ตัวนับงานรออนุมัติไม่นับตารางกะ

**อาการ** กระดิ่ง, Dashboard, ศูนย์อนุมัติ แสดง 0 แต่มีตารางกะ PENDING 17 รายการ

**สาเหตุที่พบในโค้ด**
- `src/services/approval-center.service.js:182` และ `:517` — `SCHEDULE_APPROVAL: 0` **hardcode**
- frontend อ่านค่านี้ที่ `frontend/src/main.tsx:1951–1953` (`getApprovalCenterSummary` → `setPendingApprovalCount`) แล้วใช้ที่ badge เมนู `:3108`, กระดิ่ง `:3128`, Dashboard `:2463`

**สิ่งที่ต้องทำ**
1. Backend `approval-center.service.js`:
   - summary (บรรทัด ~160–190): เพิ่ม task นับ `prisma.scheduleApproval` ที่ `status: 'PENDING'` **เฉพาะ revision ล่าสุดของแต่ละเดือน** (ไม่นับ revision ที่ถูกแทนที่) เมื่อ `allowed('SCHEDULE_APPROVAL')` และ role เป็น ADMIN/SUPERVISOR (ตาม RBAC ใน `operations.routes.js:782`)
   - list (บรรทัด ~300–520): เพิ่ม item type `SCHEDULE_APPROVAL` ในรูปแบบเดียวกับ type อื่น (title: "ตารางกะ <เดือน> ฉบับที่ <revision>", submittedAt: `changedAt`, link ไป `approvals`)
   - ถ้า `allowed()` / policy matrix ยังไม่มี `SCHEDULE_APPROVAL` ให้เพิ่มตาม pattern เดิม (ดู `components/ApprovalAuthorityMatrixPanel.tsx`) — ถ้าต้องแก้ schema ให้หยุดและรายงาน
2. Frontend `ApprovalCenterPage.tsx`: แสดง type ใหม่ + ปุ่มเปิดไปหน้าอนุมัติตารางกะ
3. เพิ่ม test ใน `test/` สำหรับ summary: มี PENDING rev ล่าสุด 1 + rev เก่า PENDING 2 → `byType.SCHEDULE_APPROVAL === 1`

**Acceptance criteria**
- [ ] กระดิ่ง = badge เมนู = Dashboard = การ์ด PENDING ในศูนย์อนุมัติ = ผลรวมจริง (รวมตารางกะ)
- [ ] revision ที่ถูกแทนที่ไม่ถูกนับ

---

## T06 — หน้า Login และหน้า Public

**ข้อเท็จจริงจากโค้ด:** backend รับเฉพาะอีเมล — `src/routes/auth.routes.js:14` `email: z.string().email()` → **แก้ที่ป้าย ไม่ต้องรองรับ username**

**ไฟล์:** `frontend/src/main.tsx:516` (ช่อง login), `frontend/src/components/AwardPublicExperience.tsx` (หน้า public), `frontend/src/ux04-auth-experience.test.ts`

**สิ่งที่ต้องทำ**
1. ป้ายช่อง login `ชื่อผู้ใช้หรืออีเมล (Corporate Email)` → "อีเมลองค์กร"
2. validation ภาษาไทย (`setCustomValidity` หรือ validate เองก่อน submit) แทนข้อความเบราว์เซอร์ "Please include an '@'…"
3. ลบ placeholder `••••••••••••` ของช่องรหัสผ่าน
4. "ลืมรหัสผ่าน?" พื้นที่กด ≥ 44px สูงบนมือถือ (ปัจจุบัน 15px) และ contrast ≥ 4.5:1
5. หน้า public มี `<h1>` สองตัว → login block เป็น `<h2>`
6. มือถือ: ฟอร์ม login อยู่ที่ ≈ 2,700px — ให้ปุ่ม "เข้าสู่ระบบ" ใน header/hero เลื่อนไปฟอร์มและ focus ช่องอีเมล และบน ≤ 768px ย้าย section login ขึ้นมาหลัง hero ทันที (ถ้าทำ T09 แล้ว ใช้ `/login` แยกหน้า)
7. ข้อความตกแต่ง < 12px ใน `AwardPublicExperience.tsx` → `aria-hidden="true"`; ที่ต้องอ่านได้ → ≥ 12px

**Acceptance criteria**
- [ ] ไม่มีข้อความ validation ภาษาอังกฤษ
- [ ] มือถือ: กด "เข้าสู่ระบบ" แล้วเห็นช่องอีเมลในจอทันที
- [ ] Lighthouse Accessibility หน้า public ≥ 90

---

# P1 — พร้อม Pilot

## T07 — ศูนย์อนุมัติเป็น Inbox เดียว

**ต่อจาก T05** (ต้องนับตารางกะได้ก่อน)

**ไฟล์:** `frontend/src/pages/approvals/ApprovalCenterPage.tsx`, `frontend/src/approval-center-client.ts`, nav ใน `main.tsx:160–185`

**สิ่งที่ต้องทำ**
1. หัวหน้า: ชิปกรองตามประเภทจริงจาก `byType` (ซ่อนประเภท count 0 ที่ผู้ใช้ไม่มีสิทธิ์)
2. แถว: ประเภท (ไทย), ผู้ส่ง, สรุป 1 บรรทัด, วันที่ส่ง, "รอ N วัน", ปุ่ม "ดูรายละเอียด"
3. ย้าย "Event Stream / LIVE SECURITY AUDIT" ออกจากหน้านี้ (มีอยู่แล้วในหน้าบันทึกการใช้งาน)
4. เมนูซ้าย: ให้ "อนุมัติตารางกะ" (`approvals`) เข้าถึงจากเมนูได้ หรือเข้าผ่าน Inbox (ตอนนี้ซ่อนหลังปุ่มในหน้าตารางกะ)
5. คำขอลงทะเบียน (`RegistrationReviewPanel.tsx`, ท้ายหน้าผู้ใช้ ≈ 4,900px) — ให้ Inbox ลิงก์ตรงไปที่ panel (scroll + focus)

**Acceptance criteria**
- [ ] หัวหน้างานเห็นงานรอทุกประเภทในหน้าเดียว และตัวเลขตรงกับกระดิ่ง

---

## T08 — หน้ารายละเอียดอนุมัติมาตรฐาน

> **การตัดสินใจของเจ้าของระบบ (7 ต.ค. 2569) หลัง Codex บันทึก blocker ใน #500:**
> ระบบไม่มี snapshot ของตารางกะแต่ละ revision จึงแสดง diff ไม่ได้อย่างปลอดภัย →
> - ทำ T08 **โดยไม่มี diff ของตารางกะ**: หน้ารายละเอียดของ **ลา** และ **อุปกรณ์ลงเวลา** ทำให้ครบตามข้อ 1–7 ด้านล่าง
> - **ตารางกะ:** แสดงเฉพาะ metadata ที่มี (เดือน, ฉบับที่, สถานะ, ประเภทการเปลี่ยน, เวลาที่เปลี่ยน, หมายเหตุ) + ปุ่ม **"เปิดตารางกะเดือนนี้"** พาไปหน้าตารางกะของเดือนนั้น — ข้อ 3 (diff) และข้อ 4 (ผลตรวจกฎ) ของตารางกะ **ข้ามไปก่อน**
> - **ห้ามเพิ่ม schema / migration และห้ามเดา diff จาก audit log**
> - การเก็บ snapshot ต่อ revision เพื่อทำ diff จริง = งานแยกในอนาคต ต้องขออนุมัติ schema ก่อน

**อาการ** dialog รายละเอียด revision ตาราง: หัวข้อเป็น UUID (`52ddb6b5-…`), ไม่มีผู้ส่ง, ไม่มี diff, ไม่มีผลกระทบ, ไม่มีคำเตือนผิดกฎ (หน้ากฎพบ 17 รายการ) / การ์ด "แตะเพื่อเปิดรายละเอียด" เป็น `div`

**ไฟล์:** drawer ใน `OperationalTable` (`main.tsx:990–1010`), `components/personnel/PersonnelTable.tsx:44` ("แตะเพื่อเปิดรายละเอียด"), `ApprovalCenterPage.tsx`, `components/LeaveDecisionConfirmation.tsx` (ต้นแบบที่ดี)

**สิ่งที่ต้องทำ** — component `ApprovalDetail` ใช้ร่วม:
1. หัวข้อภาษาคน ("ตารางกะ ต.ค. 2569 · ฉบับที่ 4"); UUID ไปอยู่ "ข้อมูลอ้างอิง" แบบพับ
2. ผู้ส่ง + เวลา + สถานะ (map จาก T04)
3. สิ่งที่เปลี่ยน: ตารางกะ = diff กับฉบับที่อนุมัติล่าสุด (พนักงาน / วันที่ / เดิม → ใหม่, จำนวนช่อง) — **ตรวจว่ามี API ให้ข้อมูลระดับ revision หรือไม่ ถ้าไม่มี ให้หยุดและเสนอ endpoint** / ลา = ประเภท, ช่วงวัน, จำนวนวัน, เหตุผล, ไฟล์แนบ / อุปกรณ์ = ชื่อเครื่อง, เครื่องเดิม
4. ผลกระทบ: ลา = โควตาคงเหลือก่อน→หลัง, กะที่กระทบ; ตารางกะ = ผลตรวจกฎ (ใช้ API เดียวกับหน้ากฎ `RuleCheckingDataSurfaces` `main.tsx:2986`)
5. ปุ่มตัดสินใจ sticky ล่าง; อนุมัติที่มีคำเตือน → ต้องติ๊ก "รับทราบคำเตือน"; ไม่อนุมัติ → บังคับเหตุผล; กันกดซ้ำ; สำเร็จ → ไปรายการถัดไป
6. การ์ด/แถวที่คลิกได้ เป็น `<button>` หรือ `role="button" tabIndex={0}` + Enter/Space; เปลี่ยน "แตะเพื่อเปิดรายละเอียด" → "ดูรายละเอียด"

**Acceptance criteria**
- [ ] ไม่มี UUID ในหัวข้อ / เปิดและตัดสินใจได้ด้วยคีย์บอร์ดล้วน / ตารางที่ผิดกฎเห็นคำเตือนก่อนอนุมัติ

---

## T09 — URL แยกทุกหน้า

**สาเหตุ:** นำทางด้วย `useState<Page>` (`main.tsx:134` type, `:1666` state) ไม่มี router; มีแค่ `?leaveMonth` (`main.tsx:297`, popstate `:1826`) — Vercel rewrite ทุก path ไป `index.html` อยู่แล้ว (`vercel.json`)

**สิ่งที่ต้องทำ** (ไม่ต้องเพิ่ม library — ใช้ History API)
1. สร้าง `frontend/src/routing.ts`: map `Page` ↔ path, `pageFromLocation()`, `navigate(page, query?)` (pushState) และฟัง `popstate`
2. แทน `setActivePage(x)` ทุกจุด (≈ 30 จุดใน `main.tsx`) ด้วย `navigate(x)`; initial state อ่านจาก URL (คง `initialSmsPwaPage()` สำหรับ PWA)
3. path:

| Page id | path | | Page id | path |
|---|---|---|---|---|
| dashboard | `/app` | | leave | `/app/leave` |
| employees | `/app/employees` | | leavePending | `/app/leave/approvals` |
| licenses | `/app/licenses` | | leaveHistory | `/app/leave/history` |
| attendance | `/app/time-clock` | | quota | `/app/leave/quotas` |
| attendanceSupervisor | `/app/attendance` | | approvalCenter | `/app/approvals` |
| attendanceDevice | `/app/devices` | | rules | `/app/rules` |
| schedule | `/app/roster` | | audit | `/app/audit` |
| approvals | `/app/roster/approvals` | | dataQuality | `/app/data-quality` |
| shiftSetup | `/app/shift-codes` | | systemHealth | `/app/system-health` |
| users | `/app/users` | | reportCenter | `/app/reports` |
| securitySite | `/app/sites` | | settings | `/app/settings` |

   (page id อื่นที่เหลือใน `type Page` ให้กำหนด path ตามรูปแบบเดียวกัน)
4. query: เดือน/หน่วยงาน/สถานะ/หน้า เช่น `/app/roster?month=2026-10&dept=WCS` (ย้าย `leaveMonth` เข้ามาในระบบเดียวกัน)
5. ยังไม่ login + เปิด deep link → login แล้วกลับ path เดิม; ไม่มีสิทธิ์ → หน้า 403 ไทย; path ไม่รู้จัก → 404
6. `document.title` = "<ชื่อหน้า> · SMS"
7. ระวัง: logic ที่อาศัย `activePage` ใน `useEffect` (`main.tsx:1709`, `1767`, `2000`) ต้องทำงานเหมือนเดิม

**Acceptance criteria**
- [ ] ทุกเมนูเปลี่ยน URL / Back-Forward ใช้ได้ / Refresh อยู่หน้าเดิมพร้อม filter / เปิดลิงก์ในแท็บใหม่ได้หน้าเดิม

---

## T10 — ข้อมูลพนักงาน: ย่อ "ความพร้อมก่อนเริ่มลงเวลา"

**อาการ:** การ์ดความพร้อม 58 ใบ ดันตารางพนักงานไปที่ ≈ 5,100px

**ไฟล์:** `components/personnel/AttendanceReadinessCenter.tsx` (render ที่ `pages/personnel/PersonnelDirectoryPage.tsx:139`), `components/personnel/PersonnelTable.tsx`

**สิ่งที่ต้องทำ**
1. Readiness Center ค่าเริ่มต้น = แถบสรุปบรรทัดเดียว "พร้อม X · ไม่พร้อม Y" + ปุ่ม "ดูรายละเอียด" (พับ)
2. เพิ่มคอลัมน์ "ความพร้อม" ใน `PersonnelTable` + ตัวกรอง พร้อม/ไม่พร้อม (ใช้ข้อมูล API readiness เดิม)
3. `READY`/`NOT_READY` → "พร้อม"/"ไม่พร้อม"

**Acceptance criteria**
- [ ] 1366×768: ตารางพนักงานเริ่มภายใน 900px แรก

---

## T11 — ตารางกะรายเดือน

**ไฟล์:** `frontend/src/main.tsx:2759–2900` (kicker `:2759`, heading `:2765`, `MonthGridPicker` `:2772`, ข้อความ dev `:2822`, ช่องกะ `:2899` "MANUAL 🔒"), `components/MonthGridPicker.tsx`, `styles/data-surfaces.css`

**สิ่งที่ต้องทำ**
1. `thead th` ของตาราง calendar → `position: sticky; top: <ความสูง topbar>`; ช่องมุมซ้ายบน sticky ทั้งสองแกน (คอลัมน์ชื่อ sticky อยู่แล้ว)
2. โหมด "กะทัดรัด" (ค่าเริ่มต้น): ช่องแสดงรหัสกะ + สีพื้น กว้าง ≈ 44px → เห็น 31 วันในจอ 1366px; toggle "แสดงเวลา"
3. `main.tsx:2899` `MANUAL 🔒` → ไอคอนกุญแจเล็กมุมช่อง + `title="ล็อกโดยผู้ดูแล"` (ลบ inline style สีส้ม)
4. ไฮไลต์วันนี้ + เสาร์/อาทิตย์
5. แถวสรุปท้าย: จำนวนคน D/N ต่อวัน, ไฮไลต์วันที่ต่ำกว่าขั้นต่ำ (RULE003/004)
6. kicker `SMS NEXUS / PERSONNEL / DUTY ROSTER`, การ์ด `AWAITING DATA` (ROSTER READINESS / SHIFT COVERAGE) → ลบหรือแสดงข้อมูลจริง
7. `MonthGridPicker`: แสดง "ตุลาคม 2569" (ดู T16)

**Acceptance criteria**
- [ ] เลื่อนถึงแถวสุดท้ายยังเห็นหัววันที่ / โหมดกะทัดรัดเห็นทั้งเดือนใน 1366px

---

## T12 — ตั้งค่าระบบแบ่งหมวด

**อาการ:** หน้าเดียวยาว ≈ 19,859px / key ดิบ `ATTENDANCE_GPS_AUTO_PASS_ACCURACY_METERS` / input 4 ช่องไม่มี label (`Code เช่น SEC`, `ชื่อหน่วยงานใหม่`, `Code เช่น OFFICER`, `ชื่อตำแหน่งใหม่`)

**ไฟล์:** `function SettingsPage` `main.tsx:1089` (render `:3044`), panels ใน `components/*Panel.tsx` / `*Card.tsx`, `styles/configuration-center.css`

**สิ่งที่ต้องทำ**
1. แท็บ/เมนูย่อยซ้าย: ภาพรวม · การลงเวลาและตำแหน่ง · นโยบายการลา · ประเภทการลา · รูปแบบจัดกะอัตโนมัติ · หน่วยงานและตำแหน่ง · สิทธิ์อนุมัติ · การเก็บรักษาข้อมูล · การแจ้งเตือน (รวม LINE) — sync กับ URL `/app/settings/<section>` ถ้าทำ T09 แล้ว
2. Registry: แสดง ชื่อ + คำอธิบาย + ค่าปัจจุบัน + ช่วงที่อนุญาต; key ดิบอยู่ส่วนพับ "สำหรับผู้ดูแลเทคนิค"; `Default / Not set` → "ใช้ค่าเริ่มต้น (X)"
3. ใส่ `<label>` ให้ 4 input
4. ลบปุ่ม "Google Sheets ถูกยกเลิก" (ถ้ายังไม่ได้ทำใน T03)

**Acceptance criteria**
- [ ] แต่ละหมวด ≤ ~3 จอ / axe ไม่มี input ไม่มี label

---

## T13 — ฟอร์มยื่นลา

**ไฟล์:** `main.tsx:1623` (`-- เลือกพนักงาน --`), `LeaveManagementPage` (render `main.tsx:2956`), หน้าโควตา `main.tsx:3052`

**สิ่งที่ต้องทำ**
1. role พนักงาน: ช่องพนักงานล็อกเป็นตัวเอง (ไม่แสดง select)
2. หัวหน้า/Admin: เปลี่ยน native select 66 ชื่อ เป็น combobox ค้นหาได้ (ชื่อ/รหัส EMP) ไม่เพิ่ม library — ใช้ `<input list>` + `<datalist>` หรือ component เล็กในโปรเจกต์; ค่าเริ่มต้น = ตัวเอง
3. เลือกประเภทลา → แสดง "คงเหลือ X วัน (สิทธิ์ Y / ใช้แล้ว Z)" + เตือนถ้าเกิน
4. ช่องวันที่แบบไทย (T16)
5. หน้าโควตา: เพิ่ม "คงเหลือ" ทุกประเภท; แก้ `<h1>` ซ้ำ 2 ตัว

**Acceptance criteria**
- [ ] พนักงานยื่นลาโดยไม่ต้องเลือกชื่อตัวเอง / เห็นคงเหลือก่อนส่ง

---

## T14 — Onboarding checklist ต่อพนักงาน

**ข้อมูล:** staging มี READY 0 / NOT_READY 58 — มีโค้ด `onboarding-readiness` อยู่แล้ว (`frontend/src/onboarding-readiness.test.ts`)

**ไฟล์:** `components/personnel/PersonnelDetailDrawer.tsx`, `AttendanceReadinessCenter.tsx`

**สิ่งที่ต้องทำ**
1. ใน drawer พนักงาน: การ์ด checklist ☐ บัญชีผู้ใช้ผูกแล้ว ☐ รูปอ้างอิง ☐ ใบอนุญาต รปภ. ยังไม่หมดอายุ ☐ จับคู่โควตาวันลา ☐ อุปกรณ์อนุมัติแล้ว ☐ มีกะในตารางที่อนุมัติ — แต่ละข้อมีปุ่ม "ไปจัดการ" ลิงก์ไปหน้าที่เกี่ยวข้องพร้อมเลือกพนักงานไว้
2. ใช้ข้อมูลจาก API readiness เดิมเท่านั้น
3. เชื่อมกับ T02: หน้าลงเวลาแสดงข้อที่พนักงานทำเองได้

---

# P2 — ระดับ Enterprise

## T15 — ภาษาและชื่อหน้า

**ไฟล์ชื่อหน้า:** `main.tsx` page meta (~บรรทัด 860–900), `main.tsx:2660`, `:2983`, `:2067`, `pages/dashboard/DashboardPage.tsx:46–48`, `pages/approvals/ApprovalCenterPage.tsx:497`, `components/audit/AuditPageHeader.tsx:4`, `pages/audit/AuditCompliancePage.tsx:19`, `components/SecuritySiteManagementPanel.tsx:402`

| เมนู | H1 ปัจจุบัน → ใหม่ |
|---|---|
| Dashboard | Command Overview → ภาพรวม |
| รหัสกะและเวลา | Shift Setup → รหัสกะและเวลา |
| กฎการทำงาน | Rule Checking → กฎการทำงาน |
| ศูนย์อนุมัติ | Approval Center & Incident Logs → ศูนย์อนุมัติ |
| บันทึกการใช้งานระบบ | Security Incident Logs & Audit Trail → บันทึกการใช้งานระบบ |
| จุดรักษาความปลอดภัยและ QR | GIS Surveillance & Site Control → จุดรักษาความปลอดภัยและ QR |
| ตั้งค่าระบบ | Configuration Center → ตั้งค่าระบบ |
| คำขอลา | ระบบจัดการการลา (Leave Management) → คำขอลา |

อื่น ๆ:
- ลบวงเล็บอังกฤษซ้ำ: "(Submit Leave Request)", "(My Leave History)", "(All Employee Leaves & Print A4)"
- ป้ายอังกฤษตัวพิมพ์ใหญ่ตกแต่ง (`TODAY / RECOMMENDED FLOW`, `ACTIVE PERSONNEL`, `LIVE TELEMETRY` …) → ไทยหรือเอาออก
- ชื่อกฎ RULE001–009 แสดงชื่อไทย; หน่วย `boolean` ไม่แสดง, `hours` "ชม.", `people` "คน" (frontend map; ไม่แก้ข้อมูล DB)
- บทบาท: ใช้ `role-display.ts` ที่มีอยู่ให้ครบทุกที่ (ตอนนี้หน้าผู้ใช้ยังมี "Supervisor" ปน)
- มี test `enterprise-hardcoded-surface-guard.test.ts` — เพิ่ม guard ว่าไม่มีชื่อหน้าอังกฤษตามตารางข้างบน

## T16 — วันที่และเวลา

1. util กลาง `formatThaiDate / formatThaiMonth / formatThaiDateTime` (th-TH, พ.ศ.) — ตรวจว่ามี helper อยู่แล้วใน `main.tsx` (`date()`, `bangkokDateInput`) แล้วรวมเป็นที่เดียว
2. `components/MonthGridPicker.tsx`: แสดง "ตุลาคม 2569" ไม่ใช่ "October, 2026"
3. `type="date"` 13 จุดใน `frontend/src` แสดง mm/dd/yyyy ตาม locale เบราว์เซอร์ → ทำ component วันที่ที่แสดง วว/ดด/พ.ศ. แต่ส่ง ISO เหมือนเดิม (ไม่เพิ่ม library)
4. เวลากะ: validate ตอนบันทึกในหน้ารหัสกะ (แปลง `07.00` → `07:00`); ข้อมูลเดิม PND / PNN / PSN ที่เป็น `07.00` → **รายงานให้เจ้าของระบบ** ไม่แก้ DB ใน Task นี้
5. dropdown เดือนในหน้ากฎ (`main.tsx:2983` บริเวณ) สร้างจากช่วงข้อมูลจริง ไม่ hardcode 2568–2569

## T17 — Accessibility

1. ตัวอักษรขั้นต่ำ 12px — โดยเฉพาะ `.eyebrow { font-size: 10px !important }` ที่ `styles.css:138` และป้าย 8–9px ใน Dashboard, ศูนย์อนุมัติ, `security-site-management.css`
2. แถบสถิติสีเข้มในหน้าจุดรักษาความปลอดภัย (`SecuritySiteManagementPanel.tsx:409–412`): ตัวเลขมองไม่เห็น → แก้สี
3. ปุ่ม "ปิดใช้งาน" หน้ารหัสกะ (`main.tsx:2660` ส่วนตาราง) → outline แดง + dialog ยืนยัน; "แก้ไข" เป็นปุ่มหลัก
4. 1 หน้า = 1 `<h1>`; ชื่อคนในตารางผู้ใช้ (`AccessManagementPage.tsx`) ไม่ใช่ `<h2>`
5. คิวอนุมัติว่าง → empty state "ไม่มีงานรออนุมัติ" แทนแถว skeleton (`main.tsx:1046` pattern)
6. header มือถือ: ซ่อนปุ่ม "Desktop", ชื่อ "SMS Security…" ไม่ถูกตัด
7. เป้าหมาย: axe ไม่มี serious/critical; Lighthouse Accessibility ≥ 90 ทุกหน้า

## T18 — ความเร็ว API (backend)

**ข้อมูล:** หน้าประสิทธิภาพ: p50 2,914 ms, p95 9,372 ms, DB 740 ms — branch ปัจจุบันชื่อ `fix/serverless-database-reliability` แสดงว่าทีมกำลังทำเรื่องนี้อยู่ → **ประสานกับงานนั้นก่อน**
1. ใช้ตาราง "API latency by route template" (`pages/system-health/SystemHealthPage.tsx`) หา 10 route ช้าสุด
2. ต่อ route ตรวจ: N+1, index ที่ขาด (`prisma/schema.prisma`), list ที่ไม่ paginate, cold start, region DB vs function
3. รายงานก่อน/หลัง; เป้าหมาย p95 < 1,500 ms
4. index / migration ต้องขออนุมัติตาม AGENTS.md ก่อน

## T19 — Dashboard

**ไฟล์:** `pages/dashboard/DashboardPage.tsx`, `components/dashboard/*`
1. ลบ panel Operational Coverage (T03) แล้วย้าย "Attention Required" ขึ้นบน
2. ตัวเลขซ้ำ (กำลังพล/ลา/ใบอนุญาต แสดง 2–3 ที่) → ที่เดียว
3. การ์ดทุกใบคลิกไปหน้าที่กรองตรงตัวเลข (ใช้ `navigate` จาก T09)
4. ตัวเลขอนุมัติใช้ค่าจาก T05

## T20 — E2E

repo ยังไม่มี Playwright — **เสนอก่อนติดตั้ง** ถ้าอนุมัติ ให้เขียนอย่างน้อย:
1. พนักงานยื่นลา → หัวหน้าเห็นใน Inbox → ไม่อนุมัติโดยไม่ใส่เหตุผลไม่ได้ → อนุมัติ → พนักงานเห็นสถานะ
2. แก้ตารางกะ → ตัวนับ +1 → อนุมัติ → revision เก่าเป็น "ถูกแทนที่" → reject แถวที่อนุมัติแล้วไม่ได้
3. พนักงานไม่มีอุปกรณ์ → หน้าลงเวลาบอกเหตุผล + พาไปลงทะเบียน
4. deep link `/app/roster?month=2026-10` ตอนยังไม่ login → login → กลับหน้าเดิม
(รันกับ local/preview ที่ใช้ฐานข้อมูลทดสอบเท่านั้น)

---

# ชุดเพิ่มเติม — ตารางกะ (เพิ่ม 6 ต.ค. 2569)

> ทำเป็น **PR แยกกันทีละ Task** ตามลำดับ: T04b → T21 → T23 → T22
> ทุก Task แตะ `frontend/src/main.tsx` ส่วนตารางกะ → ทำ **ทีละ Task** และ rebase บน base ล่าสุดก่อนเริ่ม Task ถัดไป เพื่อลด conflict

## T04b — ปิดงานค้างของ PR #470 (แก้ใน PR #470 เดิม)

1. `src/routes/operations.routes.js` `PUT /schedule-approvals/:id`: ถ้า `before.status` เป็น `APPROVED` หรือ `REJECTED` และ `input.status !== before.status` → 409 `SCHEDULE_APPROVAL_INVALID_STATE` (ปิดทาง APPROVED → PENDING/DRAFT ที่ล้าง `approvedAt`) + test: ส่ง PENDING และ DRAFT ไปที่แถว APPROVED → 409 และ `approvedAt` ไม่เปลี่ยน
2. `frontend/src/main.tsx` `handleOperationAction`: `approvals` + `reject` → ใช้ dialog กรอกเหตุผลเป็นการยืนยันครั้งเดียว (ข้าม `actionDialog.confirm`); approve คง confirm เดิม
3. ข้อความ `SCHEDULE_APPROVAL_SUPERSEDED` (backend + `frontend/src/approval-display.ts`) → "รายการนี้มีฉบับที่ใหม่กว่าแล้ว จึงดำเนินการต่อไม่ได้"

---

## T21 — เรียงพนักงานในตารางกะตามแผนก แล้วตามรหัสพนักงาน

**ปัจจุบัน:** `frontend/src/schedule-employee-code-order.ts` — `sortScheduleEmployeesByCode()` เรียงตาม `employeeCode` อย่างเดียว ใช้ที่ `main.tsx:2672` (ตารางบนจอ) และ `main.tsx:3061` (`printData` สำหรับพิมพ์) ส่วน Excel เรียงแยกที่ `src/services/schedule-export.service.js:76`

**ลำดับใหม่ (ตกลงแล้ว):**
1. รหัส/ชื่อแผนก (`employee.department` เช่น AN0, AN1, PO11, WCS) — เรียงแบบ natural (`Intl.Collator('en', { numeric: true, sensitivity: 'base' })`) ให้ AN2 มาก่อน AN10
2. ภายในแผนกเดียวกัน → `employeeCode` (natural)
3. เสมอกัน → `id`
4. พนักงานที่ไม่มีแผนก → ไว้ท้ายสุด

**สิ่งที่ต้องทำ**
1. เพิ่มฟังก์ชัน `sortScheduleEmployeesByDepartment()` ในไฟล์เดิม (คงฟังก์ชันเดิมไว้ถ้ายังมีที่อื่นเรียกใช้) แล้วเปลี่ยน `main.tsx:2672` และ `:3061` มาใช้ฟังก์ชันใหม่
2. ตารางบนจอ: แทรกแถวหัวกลุ่มแผนก (เช่น "PO11 · 12 คน") คั่นระหว่างแผนก — แถวหัวกลุ่มต้อง sticky คอลัมน์ซ้ายเหมือนชื่อพนักงาน และไม่นับเป็นแถวพนักงาน
3. ฉบับพิมพ์ (`schedule-print.ts`) และ Excel (`schedule-export.service.js:76`) เรียงแบบเดียวกัน — แยก comparator ฝั่ง backend เป็นฟังก์ชันเล็กที่มี unit test
4. ตัวกรองแผนก (`selectedDepartments`) ทำงานเหมือนเดิม
5. อัปเดต test เดิมที่ล็อกการเรียงตามรหัส (`owner-roster-code-brand.test.ts`, `schedule-print.test.ts` และที่อ้าง `sortScheduleEmployeesByCode`) ให้ตรง requirement ใหม่ + เพิ่ม test: AN2 < AN10, แผนกว่างอยู่ท้าย, ในแผนกเรียงตามรหัส

**Acceptance criteria**
- [ ] จอ, พิมพ์, Excel เรียงลำดับเดียวกัน: แผนก → รหัสพนักงาน
- [ ] มีหัวกลุ่มแผนกคั่นในตารางบนจอ

---

## T22 — บันทึกตารางกะได้ถึง 1,000 รายการในครั้งเดียว

**อาการ:** บันทึกเกิน ~150 กะแล้วล้มเหลว (PR #466 "Fix large schedule batch timeout" merge ไปแล้วแต่ยังไม่พอ)

**สาเหตุที่พบในโค้ด**
- `src/services/schedule.service.js:77` `saveBatchAssignments()`: ตรวจสอบข้อมูลใน memory ได้ดีแล้ว (โหลด employee / shiftType / license / projected state ล่วงหน้า — `ensureEmployeeOperationalForShift` ไม่ยิง query เพิ่มเมื่อมี resolver) **แต่เขียนลง DB ทีละแถว** ด้วย `tx.shiftAssignment.upsert()` ในลูป (~บรรทัด 194) ภายใน interactive transaction เดียว (`timeout: 60000` บรรทัด 257) และ Vercel function `maxDuration: 60` (`vercel.json`)
- หน้าสถานะระบบวัด DB latency ได้ ≈ 740 ms → แต่ละ round-trip ช้า, 150 upsert ≈ หมด 60 วินาที
- แถวที่ใช้ license override เขียน `audit.log` ทีละแถวในลูปด้วย
- response ส่ง record ทุกแถวกลับ (`data: results`) — payload ใหญ่โดยไม่จำเป็น
- ฝั่ง client `frontend/src/api.ts:314` `batchSaveShifts()`: การลบยิง `DELETE /shifts/:id` **ทีละรายการแบบขนาน** แยกจาก batch → ไม่ atomic, อาจสร้าง revision หลายครั้ง และชน connection pool

**สิ่งที่ต้องทำ — Backend** (ห้ามเปลี่ยน business rule / การตรวจ license / RBAC / revision logic)
1. คง validation ทั้งหมดในลูปเดิม แต่ **เก็บผลเป็น array ของแถวที่จะเขียน** แทนการ upsert ทันที
2. เขียนลง DB แบบ set-based ใน transaction เดียว:
   - ใช้ `tx.$executeRaw` กับ `INSERT … SELECT FROM unnest(...) ON CONFLICT ("workDate","employeeId") DO UPDATE SET …` (unique key `workDate_employeeId` มีอยู่แล้ว) แบ่ง chunk ละ ≤ 500 แถว — ตรวจชื่อตาราง/คอลัมน์จริงจาก `prisma/schema.prisma` (`@@map` / `@map`)
   - ถ้าจะไม่ใช้ raw SQL: `createMany({ skipDuplicates: false })` สำหรับแถวใหม่ + จัดกลุ่มแถว update ที่ค่าเหมือนกันเป็น `updateMany` — ต้องได้ผลเท่ากับ upsert เดิมทุก field (`locked: true`, snapshot, license fields, `source` เฉพาะตอน create)
3. `audit.log` ของ license override → รวมเป็น `createMany` ครั้งเดียว (หรือ audit เดียวที่มีรายการใน metadata) ตาม pattern ของ audit service
4. รองรับการลบในคำขอเดียวกัน: ขยาย schema `POST /schedules/batch` เป็น `{ assignments, deletes?: uuid[] }` ลบด้วย `deleteMany` ใน transaction เดียวกัน และนับเข้า `monthChangeStats` → `updateScheduleApprovalState` เรียก **ครั้งเดียวต่อเดือน** เหมือนเดิม (ห้ามเกิด revision ต่อแถว) — ตรวจ logic ของ `DELETE /shifts/:id` เดิมว่ามีเงื่อนไขอะไร (เช่น ห้ามลบกะที่ลงเวลาแล้ว) แล้วใช้เงื่อนไขเดียวกัน
5. response คืน `{ count, months, revision }` ไม่คืน record ทั้งหมด (ตรวจว่า frontend ไม่ได้ใช้ `data` ที่คืนมา)
6. เพิ่ม `assignments: z.array(...).max(1000)` + `deletes .max(1000)` → เกิน = 400 พร้อมข้อความไทย
7. ไม่ต้องเพิ่ม index (unique `workDate_employeeId` ใช้กับ ON CONFLICT ได้แล้ว) — ถ้าพบว่าต้องเพิ่ม index/migration ให้หยุดและขออนุมัติ

**สิ่งที่ต้องทำ — Frontend**
8. `api.ts` `batchSaveShifts()`: ส่ง upserts + deletes ใน request เดียว; ลบลูป `deleteShift` แบบขนาน
9. ระหว่างบันทึก: ปุ่ม disabled + "กำลังบันทึก N รายการ…"; ถ้า > 1,000 ให้แบ่งส่งทีละ 1,000 ตามลำดับ (ไม่ขนาน) แสดงความคืบหน้า และแจ้งว่า "บันทึกสำเร็จ X / ล้มเหลว Y" — ส่วนที่ล้มเหลวคงอยู่ใน draft ให้กดบันทึกซ้ำได้
10. timeout / 5xx → ข้อความไทย "บันทึกไม่สำเร็จ ข้อมูลยังอยู่ในฉบับร่าง" (ไม่ล้าง `scheduleDrafts`)

**การทดสอบ**
11. test backend: 1,000 assignments + 50 deletes → transaction เดียว, revision เพิ่ม 1 ต่อเดือน, ผลใน DB เท่ากับวิธีเดิม (เทียบ field ทีละตัวกับ upsert เดิมในชุดเล็ก)
12. วัดเวลา: รันบน Preview กับฐานข้อมูลทดสอบ (**ห้ามใช้ Production**) บันทึก 1,000 รายการ — เป้าหมาย < 15 วินาที และรายงานเวลาจริง
13. license block / inactive employee / inactive shift type ยัง reject ทั้ง batch เหมือนเดิม

**Acceptance criteria**
- [ ] บันทึก 1,000 กะในครั้งเดียวสำเร็จ < 15 วินาทีบน Preview
- [ ] เกิด revision เดียวต่อเดือนต่อการกดบันทึก (รวมการลบ)
- [ ] กฎ license / พนักงานพ้นสภาพ / กะปิดใช้งาน ยังทำงานเหมือนเดิม
- [ ] บันทึกล้มเหลว draft ไม่หาย

---

## T23 — "ดูตัวอย่างจัดกะอัตโนมัติ" ต้องไม่แตะกะที่จัดไว้แล้ว

**ความหมายของ "จัดไว้แล้ว" (ตกลงแล้ว):** ช่องที่ (ก) มีกะบันทึกอยู่ใน DB แล้ว ไม่ว่าจะมาจากคนจัดหรือระบบ หรือ (ข) มีฉบับร่างที่ยังไม่บันทึกอยู่บนจอ → ระบบอัตโนมัติ**เติมเฉพาะช่องว่าง**

**สาเหตุที่พบในโค้ด**
- Backend `src/services/auto-schedule.service.js:258–262` `buildAutoSchedulePlan()`: map `existing` เก็บไว้เฉพาะกะ `AL` และกะที่มี `licenseOverride` เท่านั้น → กะอื่นที่มีอยู่แล้ว (รวมกะที่คนจัดเองและ `locked: true`) ถูกคำนวณใหม่ทับ
- Frontend `main.tsx:2687–2730` `applyPreviewToDrafts()`: ทุกแถวที่มี `existingShiftId` จะกลายเป็น draft `action: 'update'` → เขียนทับกะเดิมเมื่อกดบันทึก และยังเขียนทับ draft ที่ผู้ใช้แก้ค้างอยู่ด้วย (`newDrafts[key] = …`)
- `commitAutoSchedule()` (`auto-schedule.service.js` ~413) ใช้ `plan.rows.filter((row) => !row.locked)` → ต้องได้ผลถูกต้องหลังแก้ข้อ 1 ด้วย

**สิ่งที่ต้องทำ — Backend**
1. `buildAutoSchedulePlan()`: ให้ `existing` เก็บ**ทุก** assignment ในเดือนของพนักงานในขอบเขต แถวเหล่านี้เป็น `locked: true` + `preserved: true` และ `applyEmployeePattern` ต้อง**ข้ามช่องที่ locked** โดยนับ pattern ต่อเนื่องรอบ ๆ ช่องนั้น — ตรวจใน `applyEmployeePattern` ว่าเคารพ `row.locked` อยู่แล้วหรือไม่ ถ้าไม่ ให้แก้
2. ใส่ใน response: `summary.preservedExisting` (จำนวนช่องที่คงไว้), `summary.generated` (จำนวนช่องว่างที่เติม)
3. `commitAutoSchedule()` เขียนเฉพาะแถว `!locked` (ยืนยันด้วย test ว่าไม่ update แถวที่มีอยู่)
4. ห้ามเปลี่ยน rule ขั้นต่ำกำลังคน (RULE003/004) — ถ้าเติมแค่ช่องว่างแล้วไม่ถึงขั้นต่ำ ให้คืน `warnings` แทนการไปแก้กะที่มีอยู่

**สิ่งที่ต้องทำ — Frontend**
5. `applyPreviewToDrafts()` (ไม่ระบุ `replaceEmployeeId` = โหมดทั้งเดือน): ข้ามแถวที่ `row.locked` / `row.preserved` / มี `existingShiftId` / มี draft อยู่แล้วที่ key เดียวกัน → สร้างเฉพาะ draft `action: 'create'`
6. **ห้ามเปลี่ยน** โหมดรายบุคคล (`replaceEmployeeId` / ไม้กายสิทธิ์รายคน) ใน Task นี้
7. หน้าต่างพรีวิวแสดงสรุป: "จะเติม X ช่องว่าง · คงกะเดิมไว้ Y ช่อง" และไฮไลต์ช่องที่ระบบเติมให้ต่างจากช่องที่คงไว้
8. ถ้าไม่มีช่องว่างเลย → แจ้ง "ทุกช่องจัดไว้แล้ว ไม่มีอะไรให้เติม" และไม่สร้าง draft

**การทดสอบ**
9. backend: เดือนที่มีกะ D ที่คนจัดไว้ 10 ช่อง + ช่องว่าง → preview ต้องคง 10 ช่องเดิมทุกค่า และเติมเฉพาะช่องว่าง
10. frontend: มี draft ค้าง 3 ช่อง แล้วกด preview + ใช้ผล → draft 3 ช่องเดิมไม่เปลี่ยน
11. commit: ไม่มี UPDATE กับแถวที่มีอยู่ (ตรวจด้วย spy/mock หรือ DB test)

**Acceptance criteria**
- [ ] กดดูตัวอย่างแล้วใช้ผล → กะที่บันทึกไว้แล้วและฉบับร่างค้างไม่ถูกเปลี่ยนแม้แต่ช่องเดียว
- [ ] เห็นจำนวน "เติม X / คงไว้ Y" ก่อนยืนยัน

---

# ชุดเพิ่มเติม — จากการตรวจ Production หลังปล่อย R1 (7 ต.ค. 2569, SHA 31b17868)

## T24 — 🔴 ความเร็ว API (เลื่อนจาก T18 ขึ้นเป็นงานด่วน)

**วัดจาก browser บน Production (ADMIN, 1366×768):**

| API | เวลา |
|---|---|
| `GET /attendance/supervisor/daily` | **≈ 35 วินาที** (วัด 2 ครั้ง: 35.1 / 34.5 s) — ใกล้เพดาน `maxDuration: 60` |
| `GET /employees/readiness/center` | ≈ 19 วินาที |
| `GET /dashboard` | 11–16.5 วินาที |
| `GET /approval-center/summary` | 8.4 s (median), 14.7 s (max) — **ถูกเรียก 9 ครั้งในการใช้งาน ~10 นาที** (poll ของ badge) |
| `GET /executive-report` | ≈ 12 วินาที |
| `GET /schedule-calendar` | ≈ 10.8 วินาที |
| endpoint ง่าย ๆ (`/employees`, `/leave-types`, `/licenses`) | 3–6 วินาที |
| หน้า System Health: Database readiness | ≈ 777 ms ต่อ query |

**ข้อสังเกต:** แม้ endpoint ง่ายยังใช้ 3–6 วินาที และ DB readiness ≈ 0.78 s ต่อ query → สงสัย **region ของ Vercel function (`sin1`) กับ region ของ DB ไม่ตรงกัน** หรือ connection pooling ทำงานไม่ดี — เป็นต้นเหตุร่วมของทุกหน้า

**สิ่งที่ต้องทำ**
1. ตรวจ (read-only) region ของ DB เทียบกับ function region ของ Vercel project และชนิด connection (pooler / direct) — รายงานโดยไม่แสดง connection string
2. ถ้า region ไม่ตรง: เสนอแผนย้าย function region หรือ DB region พร้อมผลกระทบ — **หยุดขออนุมัติ** (เป็นการเปลี่ยน infrastructure/env)
3. `supervisor/daily`: หา N+1 / query ทีละพนักงาน ด้วย Prisma query log ในเครื่อง แล้วรวมเป็น query ชุด (แบบเดียวกับ T22)
4. `employees/readiness/center`, `dashboard`: ทำแบบเดียวกัน
5. `approval-center/summary`: ลดการ poll (เช่น ทุก 60 วินาที และเฉพาะเมื่อแท็บ active ผ่าน `document.visibilityState`) และรวม count หลายตารางให้ทำงานขนานภายใน connection เดียวที่ปลอดภัย
6. รายงานเวลา ก่อน/หลัง ของแต่ละ endpoint (วัดบน Preview)

**Acceptance criteria**
- [ ] `supervisor/daily` < 5 วินาที, endpoint อื่นในตาราง < 3 วินาที (วัดบน Preview ที่ใช้ DB region เดียวกับ Production)
- [ ] summary ไม่ถูก poll ขณะแท็บไม่ active

## T25 — 🔴 ตรวจเหตุการณ์ "USER TOKEN REUSE" (ความปลอดภัย)

**พบใน Event Stream ของศูนย์อนุมัติ:** `USER TOKEN REUSE` ของบัญชี **"Sermpong UAT"** ซ้ำอย่างน้อย 5 ครั้งใน 24 ชม. (13:24, 23:18, 00:21, 06:56, 09:14) โดย session id เดิม `f051686c-…`

**สิ่งที่ต้องทำ (read-only ก่อน)**
1. อ่าน logic ตรวจ refresh-token reuse ใน `src/` ว่าเหตุการณ์นี้หมายถึงอะไร และระบบทำอะไรต่อ (revoke family? บังคับ logout?)
2. ดึง audit ของบัญชีนี้ (read-only): IP/user-agent ที่บันทึกไว้, ช่วงเวลา, เกิดจากหลายแท็บ/หลายเครื่อง หรือ client ที่ refresh ซ้อนกัน (race)
3. ถ้าเป็น race ของ client (หลายแท็บ refresh พร้อมกัน): เสนอแก้ฝั่ง frontend ให้ refresh แบบ single-flight / ใช้ BroadcastChannel
4. ถ้าสงสัยว่า token รั่ว: **หยุดและแจ้งเจ้าของระบบทันที** พร้อมขั้นตอนแนะนำ (revoke sessions ของบัญชีนี้) — ห้าม revoke เอง
5. บัญชี "Sermpong UAT" เป็นบัญชีทดสอบบน Production — รายงานว่าควรปิดหรือจำกัดสิทธิ์หรือไม่

## T26 — ค่า legacy ที่ยังแสดง "อื่น ๆ" ในหน้าอนุมัติตารางกะ

**พบบน Production:** ส.ค. 2569 ฉบับที่ 3 และ ก.ค. 2569 ฉบับที่ 1 สถานะเป็น "อื่น ๆ"; ก.ค. 2569 ฉบับที่ 0 ประเภทเป็น "อื่น ๆ" (`status` และ `changeType` เป็น `String` อิสระใน schema)
1. query read-only: `SELECT DISTINCT status, change_type FROM schedule_approvals` (ชื่อจริงตาม `@@map`)
2. เพิ่มค่าที่พบใน `frontend/src/approval-display.ts` (ค่า null → "ไม่ระบุ")
3. ถ้าพบสถานะ legacy ที่ควรถือเป็น "รออนุมัติ" ให้รายงาน — ห้ามแก้ข้อมูลเอง

## T27 — รายละเอียดเพิ่มสำหรับ T08 (คิวอนุมัติ)

**พบบน Production ในศูนย์อนุมัติ:** แถวตารางกะแสดง UUID `52ddb6b5-…` เป็นบรรทัดแรก, avatar เป็นตัวย่อ "ตต" (มาจากคำว่า "ตารางกะ ตุลาคม"), ช่อง REQUESTER ว่าง, ตารางคิวมี scroll แนวนอนที่ 1366px
- ใช้ผู้แก้ไขล่าสุดของ revision (จาก audit `ScheduleApproval`/`ShiftAssignment`) เป็นผู้ส่ง ถ้าไม่มีให้แสดง "ระบบ"
- ไม่แสดง UUID ในแถว; avatar ใช้ไอคอนประเภทงานแทนตัวย่อ
- ตารางคิวต้องไม่ล้นแนวนอนที่ 1366px

## T28 — สิ่งเล็กที่พบเพิ่ม

1. แบนเนอร์ตารางกะแสดง "Revision 1" ระหว่างโหลด ก่อนเปลี่ยนเป็นค่าจริง (Revision 4) → ใช้กติกา T01 (ห้ามแสดงค่า default ระหว่างโหลด)
2. หน้าอุปกรณ์ลงเวลา: ประวัติอุปกรณ์แสดง enum ดิบ `ADMIN_REVOKE_CURRENT`, `FINAL_APPROVE`, `DEVICE_PROOF_VERIFIED`, `ADMIN_APPROVED_REPLACEMENT`, `AUTO_BIND_FIRST_DEVICE` → map เป็นไทย
3. หน้าบันทึกการใช้งาน: enum `LOGIN_FAILED`, `LOGOUT_ALL`, `RETURNED_FOR_CORRECTION`, และชื่อ action แบบ `REFRESHSESSION REFRESH`, `DATARETENTIONCLEANUPRUN DELETE` → map เป็นไทย (เช่น "ต่ออายุการเข้าสู่ระบบ", "ล้างข้อมูลตามนโยบายเก็บรักษา")
4. หน้าตั้งค่าระบบยาวขึ้นเป็น ≈ 21,215px (จาก 19,859px) → T12 สำคัญขึ้น
5. ตารางกะ: แผนกแบบหลายค่า (เช่น "AN1,AN2,AN3") มี 8 กลุ่ม กลุ่มละ 1 คน — เจ้าของระบบเลือกคงไว้ (ไม่ต้องแก้ตอนนี้)

---

## T29 — การพิมพ์ A4 เพี้ยน / ไม่พอดีหน้ากระดาษ

**อาการ (เจ้าของระบบแจ้ง):** กดพิมพ์แล้วข้อความใน A4 เพี้ยน ไม่พอดีหน้ากระดาษ

**จุดพิมพ์ทั้งหมดที่พบ (อ้างจากโค้ด ~commit 3ed0585 — ค้นซ้ำบน HEAD ล่าสุด):**
| จุดพิมพ์ | ไฟล์ | การตั้งค่าปัจจุบัน |
|---|---|---|
| ใบลา | `main.tsx` `LeavePrintDocument` (~1659) + effect `window.print()` (~1891) | `<style media="print">@page { size: A4 portrait }` ฝังในคอมโพเนนต์ |
| ปุ่ม "พิมพ์ / PDF" ในตาราง (ใบอนุญาต, โควต้า, ประวัติการลา, Audit) | `main.tsx` ~1090 และหน้าที่เกี่ยวข้อง | `onClick={() => window.print()}` พิมพ์ทั้งหน้าจอ |
| ตารางกะรายเดือน | `schedule-print.ts` (iframe 1123×794) + `printData` ใน `main.tsx` | A4 landscape |
| รายงานผู้บริหาร | `styles/executive-report.css:26` | `@page A4 landscape` |
| รายงานลงเวลา | `styles/attendance-report.css:173` | `@page` ของตัวเอง |
| QR จุดรักษาความปลอดภัย | `components/security-site-qr.ts:87` | หน้าต่างแยก `@page A4 portrait` |

**หลักฐานจากไฟล์ตัวอย่างของเจ้าของระบบ (ใบลา, Chrome, Production R3, พิมพ์ 07/10/2569 14:04):**
- PDF ออกมา **2 หน้า** ขนาด A4 แนวตั้ง (595×842 pt) — แนวกระดาษถูก แต่ควรเป็น 1 หน้า
- **หน้า 1 ไม่มีใบลาเลย** มีแต่ chrome ของแอป: ชื่อระบบ "SMS Security Management System", แถบเมนูล่าง (ภาพรวม / พนักงาน / ตารางกะ / การลา / ตรวจสอบ / ผู้ใช้และสิทธิ์ / รายงาน / ตั้งค่า), ป้ายผู้ใช้ "ST Sermpong T… ADMIN", "ออกจากระบบ", และรายการเมนูข้างทั้งหมด (Dashboard … ตั้งค่าระบบ, badge "ศูนย์อนุมัติ 1")
- **หน้า 2** = ตัวใบลา (หัวเอกสาร, ชื่อพนักงาน, ตารางวันลา, ช่องลงชื่อ 3 ช่อง) **ตามด้วยแถบเมนู/ชื่อระบบของแอปซ้ำท้ายหน้า**
- มีข้อความ "Security Management System 1/1" ซึ่งน่าจะเป็น header/footer ของ Chrome
- **ต้นเหตุ #1 (หลัก):** print CSS ซ่อนเฉพาะ class ชุดเก่า (`.app-shell, .sidebar, .topbar, .main-area …` ใน `styles.css` ~747–775) แต่ shell ชุดใหม่หลังรีดีไซน์ (เมนูข้าง, แถบเมนูล่างแบบ mobile/PWA, ป้ายผู้ใช้, ปุ่ม Quick nav, ปุ่มลอย) ใช้ class อื่นและไม่ถูกซ่อนตอนพิมพ์
- **วิธีแก้ที่ทนทาน:** ระหว่างพิมพ์เอกสาร ให้ซ่อน**ทุกอย่าง**ยกเว้นเอกสารที่พิมพ์ — เช่น `body.printing-leave > *:not(.leave-print-root) { display:none !important }` โดย render `LeavePrintDocument` ผ่าน portal เป็นลูกตรงของ `<body>` (หรือพิมพ์ใน iframe แยกแบบ `schedule-print.ts`) แทนการไล่ซ่อนทีละ class
- Header/footer ของ Chrome: ลด/ตั้ง `@page { margin }` ให้เหมาะ และแจ้งผู้ใช้ให้ปิด "Headers and footers" ถ้ายังเห็น (ควบคุมจาก CSS ได้ไม่ 100%)
- Acceptance เพิ่ม: พิมพ์ใบลาใน Chrome แล้ว PDF = **1 หน้า** และไม่มีข้อความเมนู/ชื่อผู้ใช้/แถบนำทางของแอปเลย (ตรวจด้วยการ extract text จาก PDF ที่ได้)

**แบบอ้างอิงที่ถูกต้อง (ใบลาที่เคยพิมพ์ได้ดี 22/08/2569):** `docs/ux-remediation/sms-v3-leave-print-reference.png`
ใบลาหลังแก้ต้องได้หน้าตาเดียวกับภาพนี้ — 1 หน้า A4 แนวตั้ง:
1. แถวบนสุดขนาดเล็ก: ซ้าย = วันเวลาที่พิมพ์ (dd/mm/พ.ศ. HH:mm:ss), ขวา = "Security Management System — แบบบันทึกการลาพนักงานรักษาความปลอดภัย"
2. หัวเรื่องกึ่งกลาง ตัวใหญ่หนา "ใบขออนุมัติลางาน" + บรรทัดรอง "พนักงานรักษาความปลอดภัย"
3. แถวชื่อ: ซ้าย "ชื่อพนักงาน: …" ขวา "วันที่พิมพ์: …" (ตัวหนา) มีเส้นคั่นใต้
4. ตารางมีเส้นขอบ 4 คอลัมน์: วันที่ลางาน | ประเภทการลา | จำนวนวัน | ผู้ปฏิบัติงานแทน / รายละเอียด (หัวตารางพื้นเทาอ่อน)
5. ช่องลงชื่อ 2 ชุด ชิดขวา: "ลงชื่อ ....... (.......) หัวหน้าพนักงานรักษาความปลอดภัย" และ "ทราบ / ลงชื่อ ....... (.......) ผู้จัดการเขต (ผู้อนุมัติ)" เว้นที่ให้เซ็นด้วยปากกาได้
6. **แก้เพิ่มจากภาพอ้างอิง:** ช่อง "ประเภทการลา" ในภาพแสดง enum ดิบ "VACATION" → ต้องแสดงชื่อไทยจากประเภทการลา (เช่น "ลาพักร้อน") และข้อความ "[บันทึกแทนโดย: MANAGER]" → ใช้ชื่อบทบาทไทยจาก `role-display.ts`
   - **สถานะหลังรีวิว #497 (7 ต.ค.):** ประเภทลาใช้ `leaveTypeDisplayText` แล้ว ✅ / ข้อความ "[บันทึกแทนโดย: MANAGER]" **ยังค้าง** — เป็นตัวหนังสือที่ถูกบันทึกลงช่องเหตุผลตั้งแต่ตอนยื่นลาแทน ต้องแก้**ที่จุดสร้างข้อความตอนยื่น** ให้ใช้ชื่อบทบาทไทย (มีผลกับใบลาใหม่เท่านั้น — **ห้ามแก้ข้อมูลใบลาเดิม**)
   - การแยกเอกสารพิมพ์ทำผ่าน iframe (`printDocument` ใน `schedule-print.ts`) และมี Playwright PDF test (1 หน้า + ไม่มีข้อความเมนู) ✅ — ยังต้องยืนยันด้วย PDF จริงจาก Chrome หลังปล่อย
7. เพิ่ม visual regression: PDF ใบลาที่ได้ต้องเป็น 1 หน้า และมีข้อความครบ 5 ส่วนข้างบน

**ต้นเหตุรอง:** `styles.css` (~บรรทัด 747) มี `@page { size: A4 landscape }` แบบ global ใน `@media print` ชนกับเอกสารที่ต้องการแนวตั้ง (ใบลา) และปุ่มพิมพ์ตารางไม่มี layout พิมพ์เฉพาะ

**สิ่งที่ต้องทำ**
1. ลบ `@page` แบบ global ออกจาก `styles.css` — ให้แต่ละเอกสารกำหนดเอง โดยใช้ named page (`@page leave { size: A4 portrait }` + `.leave-print-document { page: leave }`) หรือ class บน `<body>` ระหว่างพิมพ์ (มี `printing-leave` อยู่แล้ว)
2. **ใบลา:** A4 แนวตั้ง, ขอบ 10–15 มม., ฟอนต์ไทย (Noto Sans Thai/Kanit) ขนาด ≥ 12pt, ห้ามตัดข้ามหน้ากลางลายเซ็น (`break-inside: avoid`), พอดี 1 หน้า
3. **ปุ่ม "พิมพ์ / PDF" ของตาราง:** สร้าง print layout เฉพาะ — หัวเอกสาร (ชื่อรายงาน, ตัวกรอง, วันที่พิมพ์, ผู้พิมพ์), ตารางเต็มความกว้าง, หัวตารางซ้ำทุกหน้า (`thead { display: table-header-group }`), ไม่ตัดแถวกลางหน้า (`tr { break-inside: avoid }`), ซ่อน sidebar/topbar/ปุ่ม; ตารางกว้าง (คอลัมน์ > 7) ใช้ A4 แนวนอน
4. **ตารางกะรายเดือน:** 31 วันต้องพอดีความกว้าง A4 แนวนอน — ใช้โหมดย่อ (แสดงแค่รหัสกะ), ย่อฟอนต์ไม่ต่ำกว่า 7pt, ถ้าเกินให้ scale ลงทั้งตาราง; หัวกลุ่มแผนก (T21) ขึ้นหน้าใหม่ได้แต่ไม่ตัดกลางกลุ่ม; หัวตารางซ้ำทุกหน้า
5. **รายงานผู้บริหาร / รายงานลงเวลา:** ตรวจว่าไม่ล้นขอบ, กราฟไม่ถูกตัด
6. ทุกเอกสาร: `-webkit-print-color-adjust: exact` สำหรับสีกะ/ป้ายสถานะ, พื้นหลังขาว ตัวอักษรดำ, ไม่มี element ของหน้าจอหลุด (toast, ปุ่มลอย, Quick nav)
7. ตรวจด้วย browser จริง: ใช้ `page.emulateMedia({ media: 'print' })` + `page.pdf({ format: 'A4' })` บน build ในเครื่อง (Chromium) สำหรับใบลา, ตารางใบอนุญาต, ตารางกะ 1 เดือน, รายงานผู้บริหาร — ใช้ข้อมูล fixture ไม่ใช้ข้อมูล Production; แนบผลจำนวนหน้าและภาพตัวอย่างหน้าแรกในรายงาน (ถ้าเครื่องมือมี)

**Acceptance criteria**
- [ ] ใบลาพิมพ์ได้ 1 หน้า A4 แนวตั้ง ไม่มีข้อความล้นหรือถูกตัด
- [ ] ปุ่ม "พิมพ์ / PDF" ทุกหน้าตารางได้เอกสารที่มีหัวรายงาน ตารางไม่ล้นขอบ หัวตารางซ้ำทุกหน้า
- [ ] ตารางกะ 31 วันพอดีความกว้าง A4 แนวนอน
- [ ] ไม่มี `@page` แบบ global ที่ชนกันเหลืออยู่

---

## T30 — ทำโครงทุกหน้าให้เป็นแบบเดียวกับ Dashboard (เจ้าของระบบเลือกแบบนี้)

**แบบที่เจ้าของระบบต้องการ (วัดจาก Dashboard บน Production R3):**
- Section card: `section.workflow-journey` / `dashboard-panel` — `border-radius: 12px`, พื้น `linear-gradient(135deg, #fff, #f4fafc)`, เส้นขอบ 1px `rgb(214,229,236)`, เงา `0 8px 28px rgba(44,75,96,.08)`, padding 16px
- Kicker (ป้ายเล็กเหนือหัวข้อ): `.nexus-kicker` — ตัวเล็ก ตัวพิมพ์ใหญ่ มี letter-spacing สีม่วง `rgb(124,58,237)`
- หัวข้อ section: `h2` ฟอนต์ **Kanit** 700 ~18px สี `rgb(16,32,51)`
- คำอธิบายสีเทาใต้หัวข้อ
- การ์ดขั้นตอน (`.workflow-journey__steps > button`): พื้นขาว ขอบ 1px มน 9px, ไอคอน SVG ในกรอบสี, ป้าย "01 · PLAN", ชื่องานตัวหนา, คำอธิบาย, ลูกศร →

**ผลวัดปัจจุบัน (Production R3, ADMIN, 1366×768):**
| หน้า | ความต่าง |
|---|---|
| Dashboard | ต้นแบบ — แต่หัวข้ออังกฤษ (Command Overview, Attention Required, Personnel / Roster, Recent Signal), การ์ด 9 ใบมีคำอธิบายแค่ 2 |
| ตารางกะรายเดือน | ใกล้แบบ (Kanit + kicker) — ใช้ emoji เป็นไอคอน 💾🏢✨🪄🔒⚡ |
| ใบอนุญาต, อุปกรณ์ลงเวลา, รหัสกะ, โควต้าวันลา, กฎการทำงาน, บันทึกการใช้งาน, คุณภาพข้อมูล, สถานะระบบ, รายงาน, รออนุมัติ | หัวข้อการ์ดเป็นฟอนต์ **Inter** (ไม่ใช่ Kanit), การ์ดเนื้อหาไม่มี kicker/คำอธิบาย, radius ปน 8/11/12/14/16 |
| ลงเวลา | ดีไซน์ dark kiosk (`attendance-simple`) พื้นกรมท่าทั้งหน้า |
| ลงเวลาแทนพนักงาน | ไม่มี h1, ใช้สไตล์ `attendance-supervisor-v4` radius 20/22 |
| คำขอลา / ประวัติการลา | emoji เป็นไอคอน ⏳👤📌📅🏁👥📝📎🚀, ไม่มี kicker, ชื่อหน้าไทยปนอังกฤษ |
| ศูนย์อนุมัติ | ใช้ utility class คนละระบบ (`rounded-[8px]`), หัวข้ออังกฤษ |
| ผู้ใช้และสิทธิ์ | ไม่มี kicker, กล่อง `registration-review` พื้นเข้ม |
| จุดรักษาความปลอดภัยและ QR | สไตล์ "GIS tactical" ของตัวเอง ไม่มี section card มาตรฐาน, หัวข้ออังกฤษ 4 จุด |
| ตั้งค่าระบบ | emoji 📍💾🗓🗂🪄⌛, หัวข้ออังกฤษ 6 จุด |
| ข้อมูลพนักงาน | ไม่มี kicker, การ์ดตัวเลขไม่มีหัวข้อ |

**ปัญหาที่เจ้าของระบบชี้ (ภาพหน้าใบอนุญาต) + ผลวัดซ้ำทุกหน้า (Production R3, 1366×768):**
เจ้าของระบบระบุ 3 อาการ: (1) การ์ดไม่มนพอ (2) ตัวหนังสือชิดขอบการ์ด (3) ช่องระหว่างการ์ดมีพื้นหลังอีกสีติดมา — "เป็นแบบนี้หลายหน้า"

| อาการ | ต้นเหตุที่วัดได้ | หน้าที่เป็น |
|---|---|---|
| (3) แถบพื้นหลังซ้อน | `.view-pane` (เช่น `.data-surface-page`) มีพื้นของตัวเอง `rgb(248,249,255)` radius 0 ซ้อนบนพื้นหลักที่เป็น gradient | **19 จาก 21 หน้า** (ยกเว้น Dashboard, ผู้ใช้และสิทธิ์) — หน้าลงเวลาเป็นพื้นเข้ม `rgb(6,19,31)` |
| (2) ตัวหนังสือชิดขอบ | `.page-heading.signature-page-header` พื้นขาว radius 12 แต่ **padding 0** (h1 อยู่ x เดียวกับขอบกล่อง) | ใบอนุญาต, รหัสกะ, โควต้า, กฎการทำงาน, สถานะระบบ, ตั้งค่า, อุปกรณ์ลงเวลา (การ์ด 42/50 กล่องชิดขอบ: `page-heading`, `section-title`), ข้อมูลพนักงาน (`personnel-directory-header`), รายงาน (`report-center-heading`), ผู้ใช้ (`access-management-page`) |
| (1) มุมไม่มน / ความมนไม่เท่ากัน | wrapper ภายในการ์ดมีพื้นแต่ radius 0 (`table-scroll`, `data-table-scroll`, `audit-table-scroll`, `personnel-table-scroll`, …), การ์ดบางใบ radius 0–6 (`nexus-panel`/`nexus-stream` บน Dashboard, `approval-banner`, `calendar-toolbar-box`, `schedule-draft-actions`, `table-card` ในตารางกะ, `gis-*` 14 กล่องในหน้าจุดรักษาความปลอดภัย) | เกือบทุกหน้า — radius ที่พบปนกัน: 0/5/6/8/9/10/11/12/14/15/16/20/22/24 |

**ธีมมืด — วัดซ้ำทุกหน้า (Production R3, `prefers-color-scheme: dark`, ธีม "ตามระบบ"):** เจ้าของระบบแจ้งว่า "Dark Theme ก็เจอปัญหาเดียวกัน" — ยืนยันแล้ว และหนักกว่าธีมสว่าง
| อาการ | ต้นเหตุ | หน้าที่เป็น |
|---|---|---|
| แถบพื้นหลังซ้อน | ธีมมืดใส่พื้นให้ `.content-area` (radius 0) **ทุกหน้า** และ `.view-pane` อีกชั้นในหน้าอุปกรณ์ลงเวลา, ตารางกะ, รายงาน | 21/21 |
| มุมเหลี่ยม | wrapper มีพื้นแต่ radius 0: Dashboard 17 กล่อง (`nexus-command`, `nexus-command__hero`, `dashboard-filter-bar`, `nexus-stream` …), จุดรักษาความปลอดภัย 16 กล่อง (`gis-*`), ตั้งค่า 11, `leave-hero` (หน้าการลา 3 หน้า), `audit-compliance-page`, `nexus-approval-center`, `report-center-filters/tabs`, scroll wrapper ของตารางทุกหน้า | เกือบทุกหน้า |
| ตัวหนังสือชิดขอบ | เหมือนธีมสว่าง (`page-heading` padding 0) + อุปกรณ์ลงเวลา 43 กล่อง, ตั้งค่า 7, รายงาน 4 | ~12 หน้า |
| การ์ดขาวโผล่ในธีมมืด | `attendance-supervisor-v4__tabs`, `attendance-supervisor-v4__table-card` (ลงเวลาแทนพนักงาน), `personnel-master-column` (ตั้งค่า) ยังเป็นพื้นขาว | 2 หน้า |
| ตัวหนังสือจางอ่านยาก (contrast < 3:1) | ป้ายผู้ใช้ "ST"/"ADMIN" (2.6/2.9) **ทุกหน้า**, badge ตัวเลข (2.7), **ตั้งค่า 151 จุด**, **ศูนย์อนุมัติ 50 จุด**, ประวัติการลา 13, กฎการทำงาน 11, ปุ่ม "‹ ก่อนหน้า" ในตารางกะ (2.0), ปุ่ม "ยืนยันและส่งคำขอลา" (2.8) | ทุกหน้า |
| บั๊กเลือกธีม | ตั้ง "ตามระบบ" แล้วเปลี่ยนโหมดเครื่อง หน้าไม่เปลี่ยนตามจนกว่าจะ reload และระหว่างนั้น `<html class="dark">` แต่ `data-theme="light"` (สถานะขัดกัน → พื้น body เข้มแต่เนื้อหาสว่าง) | ทั้งแอป |

**เพิ่มเติมสำหรับธีมมืด:**
- ทุก token ใน "กติกา layout" ต้องมีคู่ธีมมืด (พื้นการ์ด, เส้นขอบ, เงา, สีตัวหนังสือหลัก/รอง/kicker) — ห้ามกำหนดสีตายตัวใน component
- `.content-area` และ wrapper ระดับหน้า **ต้อง transparent ทั้งสองธีม**
- ตัวหนังสือทุกตัว contrast ≥ 4.5:1 (ข้อความปกติ) / ≥ 3:1 (≥ 18px หนา) ในทั้งสองธีม — แก้ token สีรองของธีมมืดที่จางเกิน
- ไม่มีพื้นขาวขนาดใหญ่ในธีมมืด
- โหมด "ตามระบบ" ต้องฟัง `matchMedia('(prefers-color-scheme: dark)')` แบบ live และใช้แหล่งความจริงเดียว (`data-theme` กับ class `dark` ต้องตรงกันเสมอ)
- สคริปต์ตรวจ layout ใน Acceptance ต้อง**รันทั้งธีมสว่างและธีมมืด** + เพิ่มตรวจ contrast

**กติกา layout ที่ต้องได้ (ใช้ทุกหน้า ทั้งสองธีม):**
1. **พื้นหลังเดียวทั้งหน้า:** `.view-pane` และ wrapper ระดับหน้าทุกตัว `background: transparent` — เห็นพื้นหลักสีเดียวระหว่างการ์ด
2. **PageHeader ไม่เป็นกล่องขาว:** วางบนพื้นหลักโดยตรง (ไม่มีพื้น/เส้นขอบ) — ถ้าจำเป็นต้องเป็นการ์ด ต้องมี padding เท่าการ์ด
3. **การ์ด:** radius **16px**, padding **24px** (desktop) / **16px** (≤ 768px), ระยะห่างระหว่างการ์ด 16px — ตัวหนังสือห่างขอบการ์ดไม่น้อยกว่า padding
4. **การ์ดย่อยภายในการ์ด** (step, metric ย่อย, แถบ toolbar): radius 10px
5. **ตาราง/scroll wrapper ภายในการ์ด:** ไม่มีพื้นของตัวเอง หรือใช้ `border-radius: inherit` + `overflow: hidden` ให้มุมตามการ์ด — ห้ามมีมุมเหลี่ยมโผล่
6. **ห้ามมี radius ค่าอื่น** นอกจาก 16 (การ์ด) / 10 (ย่อย) / 999 (pill/ป้าย) / ค่าของ input-button ที่กำหนดใน token

**สิ่งที่ต้องทำ**

**T30a — วางฐาน (1 PR):**
1. สร้าง component กลางใน `frontend/src/components/layout/` (ใช้ CSS เดิมของ `workflow-journey` / `dashboard-panel` / `nexus-kicker` เป็น token ห้ามสร้างดีไซน์ใหม่):
   - `PageHeader` = kicker + h1 (Kanit) + คำอธิบาย + ช่อง actions ด้านขวา
   - `SectionCard` = kicker + h2 (Kanit) + คำอธิบาย + actions + เนื้อหา
   - `StepFlow` = การ์ดขั้นตอนแบบ "ทำงานต่อจากตรงนี้" (รับ steps: icon, label, title, desc, onClick)
   - `MetricCard` = การ์ดตัวเลข (ชื่อ + ค่า + คำอธิบาย) สไตล์เดียวกัน
2. design tokens กลาง: radius การ์ด **16px** / การ์ดย่อย **10px**, padding การ์ด 24px / 16px (มือถือ), gap 16px, เงาและเส้นขอบตามต้นแบบ, หัวข้อทุกระดับใช้ Kanit, เนื้อหาใช้ Noto Sans Thai — และทำ "กติกา layout" 6 ข้อด้านบนให้เป็นค่าเริ่มต้นของ shell (`.view-pane` transparent)
3. kicker เป็นภาษาไทย (ตาม T15) — ฟอนต์ kicker ต้องรองรับไทย (JetBrains Mono ไม่มีอักษรไทย → ใช้ Noto Sans Thai/Kanit ตัวเล็ก + letter-spacing)
4. ไอคอน: ใช้ `SmsIcon` (SVG) ที่มีอยู่แทน emoji ทุกจุด
5. test: component render ครบ + guard test ว่าไม่มี emoji ใน heading/label ของหน้า (ยกเว้นเนื้อหาที่ผู้ใช้กรอก)

**T30b — ใช้กับทุกหน้า (แยก PR ตามกลุ่ม, ทำ T15 ข้อความไทยไปพร้อมกันในหน้าเดียวกัน):**
- กลุ่ม 1 บุคลากร: ข้อมูลพนักงาน, ใบอนุญาต, อุปกรณ์ลงเวลา, ผู้ใช้และสิทธิ์ (เปลี่ยน `registration-review` เป็นพื้นสว่าง)
- กลุ่ม 2 ตารางกะ+การลา: ตารางกะรายเดือน, รหัสกะ, กฎการทำงาน, คำขอลา, รออนุมัติ, ประวัติการลา, โควต้า
- กลุ่ม 3 ลงเวลา: ลงเวลาแทนพนักงาน (ใส่ PageHeader + SectionCard, radius 12), **ลงเวลา** = เปลี่ยนเป็นธีมสว่างแบบเดียวกัน คงปุ่มลงเวลาใหญ่และ layout ที่เหมาะกับมือถือ (ห้ามแตะ logic GPS/device/offline)
- กลุ่ม 4 ระบบ: Dashboard (หัวข้อไทย + คำอธิบายครบทุกการ์ด), ศูนย์อนุมัติ (เลิก utility class คนละระบบ), บันทึกการใช้งาน, คุณภาพข้อมูล, สถานะระบบ, รายงาน, ตั้งค่า, จุดรักษาความปลอดภัย (คงตัวแผนที่ได้ แต่กรอบ/หัวข้อ/การ์ดรอบแผนที่ใช้ SectionCard ธีมสว่าง)
- ใส่ `StepFlow` ในหน้าที่มีลำดับงานชัด: ตารางกะ (เลือกเดือน → จัดกะ → ตรวจกฎ → ส่งอนุมัติ), คำขอลา (ยื่นลา → รออนุมัติ → ผลการพิจารณา), อุปกรณ์ลงเวลา (ลงทะเบียน → รออนุมัติ → พร้อมใช้งาน) — ขั้นที่ทำแล้วให้แสดงสถานะ

**Acceptance criteria**
- [ ] ทุกหน้ามี PageHeader (kicker + h1 Kanit + คำอธิบาย)
- [ ] ทุก section ที่มีหัวข้อใช้ SectionCard: radius 12, หัวข้อ Kanit, มีคำอธิบาย
- [ ] ไม่มี emoji เป็นไอคอนใน heading/ปุ่ม/ป้าย
- [ ] ไม่มีพื้นเข้มขนาดใหญ่ในธีมสว่าง (ยกเว้นตัวแผนที่)
- [ ] ตรวจด้วย browser 1366×768 และ 375×812 ทุกหน้า: computed font ของ h1/h2 = Kanit, radius การ์ด = 16px
- [ ] สคริปต์ตรวจ layout ใน browser (รันทุกหน้า แนบผลในรายงาน): (ก) `.view-pane` และ wrapper ระดับหน้าไม่มีพื้นของตัวเอง (ข) ทุกกล่องที่มีพื้น/เส้นขอบ กว้าง ≥ 240px (ยกเว้น `td/th/tr`, input, button) มี radius 16 หรือ 10 (ค) ข้อความในการ์ดห่างขอบซ้าย ≥ 16px และขอบบน ≥ 12px (ง) ไม่มีมุมเหลี่ยมของ scroll wrapper โผล่จากการ์ด
- [ ] ธีมมืดยังใช้งานได้ (token เปลี่ยนตามธีม)

---

## T31 — ใบลงเวลาประจำเดือน (พิมพ์ A4 แนวตั้ง 1 คน/หน้า)

**ต้นแบบ:** `docs/ux-remediation/sms-v3-timesheet-reference.png` (ใบลงเวลาของบริษัทที่ใช้อยู่)
**ฐานที่มีอยู่แล้ว:** `frontend/src/pages/reports/AttendanceOfficialReport.tsx` ("ใบสรุปการลงเวลาประจำเดือน", อยู่ใน `ReportCenterPage.tsx` ~135, เฉพาะ ADMIN, ปิดด้วย `ATTENDANCE_OFFICIAL_REPORT_ENABLED`, A4 แนวนอน) และ `styles/attendance-report.css` — ใช้ข้อมูล/endpoint เดิม ห้ามสร้าง API ซ้ำ

**การตัดสินใจของเจ้าของระบบ (ห้ามเปลี่ยน):**
1. **ตัดออก:** คอลัมน์ OT ทุกอัตรา (1 / 1.25 / 1.5 / 2 / 2.5 / 3) และตารางสรุปที่เกี่ยวกับ OT
2. **ตัดออก:** เบี้ยเลี้ยง, ค่าพาหนะ, ค่าเดินทาง, ค่าตำแหน่ง (ระบบไม่มีข้อมูล — ไม่เพิ่ม schema)
3. **สิทธิ์พิมพ์: "Manager ขึ้นไป"** — ⚠️ ชื่อบทบาทในโค้ดสลับกับที่แสดง (`role-display.ts`: รหัส `SUPERVISOR` แสดงเป็น "Manager", รหัส `MANAGER` แสดงเป็น "Supervisor") → อนุญาตเฉพาะรหัส **`ADMIN` และ `SUPERVISOR`** ทั้งฝั่ง UI และ API (ห้ามอนุญาตรหัส `MANAGER` / `VIEWER`) + test ครอบทั้ง 4 บทบาท
4. **หัวกระดาษ:** ใช้โลโก้เดียวกับระบบ (asset โลโก้ที่ใช้ใน sidebar/หน้า login) + ชื่อระบบ — ไม่ต้องมีหน้าตั้งค่าชื่อบริษัท

**โครงหน้าพิมพ์ (ตามต้นแบบ ตัดส่วนที่ข้อ 1–2):**
1. หัว: โลโก้ระบบ + ชื่อ, หัวเรื่อง "ใบลงเวลา" ชิดขวา, วันเวลาที่พิมพ์ (พ.ศ.)
2. กล่องข้อมูลพนักงาน: รหัสพนักงาน, ชื่อ-สกุล, ตำแหน่ง/ระดับ, แผนก, ฝ่าย, สถานที่ปฏิบัติงาน (Site), วันหยุดประจำสัปดาห์, เวลาปฏิบัติงาน (จากกะ) — ฝั่งขวา: ข้อมูลหัวหน้า/ผู้ควบคุม ถ้าระบบมี (ถ้าไม่มีให้เว้นว่าง ห้ามแต่งข้อมูล); **ไม่แสดงเบอร์โทรศัพท์** ถ้าไม่ได้อยู่ในข้อมูลพนักงานอยู่แล้ว
3. แถบ "ประจำเดือน …" + "ตั้งแต่วันที่ 1 … ถึงวันที่ …" (พ.ศ.)
4. ตารางรายวันทั้งเดือน: วันที่ (ย่อวัน + dd/mm/พ.ศ.), กะงาน (1) เวลาเข้า/ออก, กะงาน (2) เวลาเข้า/ออก (กรณีมี 2 ช่วง), ชั่วโมงปฏิบัติงาน, หมายเหตุ (วันหยุด / วันหยุดนักขัตฤกษ์ / ลา + ประเภทลาภาษาไทย / ขาด / มาสาย)
   - แถววันหยุดพื้นเทาอ่อนแบบต้นแบบ
   - ข้อมูลเวลาใช้เฉพาะรายการที่ระบบรับรองแล้ว (ตาม logic ของรายงานเดิม)
5. แถวรวม: ชั่วโมงรวมทั้งเดือน
6. ตารางสรุป (ไม่มีส่วนเงิน/OT): วันทำงาน, วันหยุด, วันหยุดนักขัตฤกษ์, ลา (แยกประเภท), ขาด, มาสาย, รวมวันในเดือน
7. ช่องลงชื่อ 4 ช่องท้ายหน้า: พนักงาน / หัวหน้าหน่วยงาน (ผู้ตรวจสอบ) / ผู้จัดการแผนก / ฝ่ายบุคคล
8. ต้องพอดี **1 หน้า A4 แนวตั้ง** สำหรับเดือน 31 วัน (ฟอนต์ตารางไม่ต่ำกว่า 7.5pt)

**การใช้งาน:**
- ในหน้า "รายงานและวิเคราะห์": เลือกเดือน → พิมพ์ "รายบุคคล" (เลือกพนักงาน) หรือ "ทั้งแผนก" (1 คน = 1 หน้า, ขึ้นหน้าใหม่ทุกคน)
- ใช้วิธีพิมพ์แบบเดียวกับ T29 (iframe/portal แยก ไม่มีเมนูแอปติด) — **ทำหลัง T29**
- ไม่แตะข้อมูล Production — ตรวจด้วยข้อมูล fixture / Preview UAT

**Acceptance criteria**
- [ ] PDF จาก Chrome: 1 คน = 1 หน้า A4 แนวตั้ง, เดือน 31 วันพอดีหน้า
- [ ] ไม่มีคอลัมน์ OT / เบี้ยเลี้ยง / ค่าพาหนะ / ค่าเดินทาง / ค่าตำแหน่ง
- [ ] โลโก้ระบบแสดงที่หัวกระดาษ
- [ ] บทบาทรหัส `ADMIN`, `SUPERVISOR` พิมพ์ได้; `MANAGER`, `VIEWER` ไม่เห็นปุ่มและ API ตอบ 403
- [ ] extract text จาก PDF แล้วไม่มีเมนู/แถบนำทางของแอป
- [ ] พิมพ์ทั้งแผนกแล้วจำนวนหน้า = จำนวนพนักงานในแผนก

---

## T32 — หน้าจอกำลังโหลด / กำลังเตรียมระบบ ด้วยโลโก้ SMS

**ไฟล์โลโก้จากเจ้าของระบบ (ฉบับพื้นใส):** `docs/ux-remediation/sms-v3-loading-logo.webp` (1536×1024, 136 KB, WebP มี alpha, โล่ + "SMS Security Management System")
- **ฉบับพื้นเข้ม (ตัวอักษรขาว):** `docs/ux-remediation/sms-v3-loading-logo-dark.webp` (1448×1086, พื้นใส)
- ตัดขอบโปร่งใสรอบโลโก้ออก (trim) **แต่ละไฟล์แยกกัน** — สองไฟล์ขนาด/สัดส่วนไม่เท่ากัน ต้องกำหนดความสูงที่แสดงให้เท่ากันเพื่อไม่ให้กระโดดตอนสลับธีม
- **เลือกไฟล์ตามสีพื้นจริงของจุดที่วาง:** พื้นสว่าง → ฉบับปกติ, พื้นเข้ม → ฉบับ `-dark` (ใช้ `data-theme` ของแอป; ใน `index.html` splash ใช้ `prefers-color-scheme` + `<picture>`) — **ไม่ต้องวางบนการ์ดสีอ่อนอีกแล้ว**

**จุดที่ต้องเปลี่ยน (ปัจจุบันเป็น `<div className="full-loader">ข้อความ</div>` — `styles.css` ~206):**
| จุด | ไฟล์ (โดยประมาณ) | ข้อความ | รูปแบบใหม่ |
|---|---|---|---|
| เปิดแอปครั้งแรก / ตรวจ session | `main.tsx` ~3458 `auth.loading` | "กำลังเตรียมระบบ…" | **เต็มจอ** |
| PWA ลงเวลา offline | `main.tsx` ~3449, ~3451 | "กำลังตรวจสิทธิ์ Offline…", "กำลังเปิดระบบลงเวลา Offline…" | **เต็มจอ** |
| โหมดตรวจ read-only | `main.tsx` ~3461 | "กำลังเตรียมการตรวจแบบ read…" | **เต็มจอ** |
| โหลดหน้า (Suspense ของ content) | `main.tsx` ~3274 | "กำลังโหลด…" | **กลางพื้นที่เนื้อหา** (ขนาดกลาง) |
| drawer / modal (รายละเอียด, ตัดสินใจลา, แก้ไขพนักงาน, passkey) | `main.tsx` ~1095, ~3211, ~3224, ~3225, ~3284 | "กำลังโหลด…" | **คงแบบเล็ก** (spinner + ข้อความ) — ห้ามใส่โลโก้ใหญ่ใน modal |
| ก่อน JavaScript โหลดเสร็จ (จอขาว) | `frontend/index.html` | — | **splash ใน HTML** (inline CSS + `<img>`) ถูกแทนที่อัตโนมัติเมื่อ React mount |

**สิ่งที่ต้องทำ**
1. ใส่ไฟล์ที่ `frontend/public/brand/sms-logo.webp` และ `frontend/public/brand/sms-logo-dark.webp` + สร้างขนาดเล็กสำหรับ splash (กว้าง ~480px) ของทั้งสองไฟล์ด้วย `sharp` ที่มีอยู่แล้ว (ไม่เพิ่ม dependency) — ขนาดไฟล์ splash ≤ 30 KB ต่อไฟล์
2. component `AppLoader` (ใช้ token จาก T30): props `variant: 'fullscreen' | 'content'`, `message`
   - fullscreen: พื้นหลังตามธีม, โลโก้กลางจอกว้าง ~240px (มือถือ ~180px) วางตรงบนพื้น (ใช้ไฟล์ตามธีม), ข้อความสถานะใต้โลโก้ (Kanit), แถบ/จุดเคลื่อนไหวเบา ๆ
   - content: โลโก้ ~120px กลางพื้นที่ `content-area`
   - `role="status"` + `aria-live="polite"`, alt="SMS Security Management System"
   - `prefers-reduced-motion: reduce` → ปิด animation
   - แสดงข้อความเดิมของแต่ละจุด (ภาษาไทย) — แก้คำว่า "read-only" / "Offline" เป็นไทยตาม T15 ("โหมดตรวจสอบอย่างเดียว", "ออฟไลน์")
3. แทน `.full-loader` ทุกจุดในตารางด้านบนตามรูปแบบที่กำหนด — **ห้ามเปลี่ยน logic ตอนโหลด/ตรวจสิทธิ์ใด ๆ**
4. splash ใน `index.html`: ใช้ไฟล์ขนาดเล็ก + `preload`, สีพื้นตาม `prefers-color-scheme`, ต้องไม่กระพริบเป็นจอขาวในธีมมืด; React mount แล้วแทนที่ (render ทับ `#root`)
5. PWA (`public/manifest.webmanifest`, `sw.js`): ถ้า service worker cache asset แบบระบุชื่อ ให้เพิ่มไฟล์โลโก้เข้า cache เพื่อให้ splash แสดงได้ตอนออฟไลน์
6. ไม่แตะ favicon / icon PWA เดิมในงานนี้

**Acceptance criteria**
- [ ] เปิดแอป (throttle Slow 3G) เห็นโลโก้ทันทีตั้งแต่ก่อน JS โหลด ไม่มีจอขาวว่าง
- [ ] "กำลังเตรียมระบบ…" และหน้าออฟไลน์ของ PWA แสดงโลโก้เต็มจอ ทั้งธีมสว่าง/มืด, 1366×768 และ 375×812
- [ ] ธีมมืดใช้ไฟล์ `-dark` (ตัวอักษรขาว) ธีมสว่างใช้ไฟล์ปกติ — สลับธีมแล้วขนาดโลโก้ไม่กระโดด
- [ ] drawer/modal ยังเป็น loader เล็ก
- [ ] reduced-motion ไม่มี animation
- [ ] ไฟล์ splash ≤ 30 KB

---

## T33 — เปลี่ยนโลโก้มุมซ้ายบนเป็นโลโก้แนวนอนชุดใหม่

**ไฟล์จากเจ้าของระบบ:**
- พื้นสว่าง: `docs/ux-remediation/sms-v3-logo-horizontal.webp` (WebP 1808×870, พื้นใส — ตัวอักษรกรมท่า)
- พื้นเข้ม: `docs/ux-remediation/sms-v3-logo-horizontal-dark.webp` (WebP 1672×941, พื้นใส — ตัวอักษรขาว)
**คำสั่งเจ้าของระบบ:** เปลี่ยนโลโก้มุมซ้ายบน **ลบตัวหนังสือที่เขียนด้วย HTML ออก** แล้วใช้ภาพนี้แทนทั้งชุด — **รวมหน้า Login และหน้าสาธารณะด้วย** (ยืนยันแล้ว 7 ต.ค. 2569)

**จุดที่ต้องเปลี่ยน (แทน `<Logo />` + `.sms-brand-copy` ด้วยภาพเดียว):**
1. เมนูด้านข้าง desktop — `main.tsx` ~3229–3231 (`<div className="sms-brand-copy"><strong>SMS</strong><span>Security Management System</span></div>`)
2. แถบบนมือถือ — `main.tsx` ~3248 (`.mobile-brand`) — ปัจจุบันชื่อถูกตัดเป็น "SMS Securi…" → ภาพต้องย่อพอดีความสูงแถบ ไม่ถูกตัด
3. แถบบน PWA — `main.tsx` ~3243 (`.pwa-mobile-brand`)
4. หน้า Login desktop — `main.tsx` ~424 (`.intro-brand.auth-brand`)
5. หน้า Login มือถือ — `main.tsx` ~490 (`.auth-mobile-brand`)
6. หน้าสาธารณะ — `components/AwardPublicExperience.tsx` ~98–100 (`.nexus-brand` + `.nexus-brand__copy`) — ลิงก์ `href="#overview"` ต้องทำงานเหมือนเดิม
- **เลือกไฟล์ตามสีพื้นจริงของจุดนั้น ไม่ใช่ตามธีมอย่างเดียว:** หน้าสาธารณะและแผงซ้ายของ Login เป็นดีไซน์พื้นเข้มแม้ในธีมสว่าง → ใช้ไฟล์ `-dark`; sidebar/แถบบนใช้ตาม `data-theme`
- ไม่แตะโลโก้ในเอกสารพิมพ์ (T29/T31 ใช้โลโก้ของตัวเอง)

**สิ่งที่ต้องทำ**
1. trim ขอบโปร่งใสรอบภาพ **แต่ละไฟล์แยกกัน** แล้วสร้างขนาดใช้งาน (สูง ~96px สำหรับ retina) ด้วย `sharp` ที่มีอยู่ — เก็บที่ `frontend/public/brand/sms-logo-horizontal.webp` และ `sms-logo-horizontal-dark.webp`, ไฟล์ใช้งาน ≤ 25 KB ต่อไฟล์
2. component `BrandLogo` (props: `tone: 'auto' | 'light-surface' | 'dark-surface'`; `<img>` + `alt="SMS Security Management System"` + `width/height` กำหนดชัด กัน layout shift) ใช้ทั้ง 6 จุด — สองไฟล์ต้องแสดงที่**ความสูงเท่ากัน**
3. ขนาด: sidebar ความสูง ~40px (ความกว้างตามสัดส่วน ≈ 83px… ปรับให้เต็มความกว้าง sidebar โดยเว้น padding), มือถือ/PWA สูง ~32px — ห้ามบีบผิดสัดส่วน
4. ลิงก์/ปุ่มที่ครอบโลโก้เดิม (ถ้ามี เช่น กลับหน้าแรก) ต้องทำงานเหมือนเดิม และมี accessible name
5. **ธีมมืด:** ใช้ไฟล์ `-dark` (ตัวอักษรขาว) วางตรงบนพื้นเข้ม — ไม่ต้องมีพื้นอ่อนรองหลัง
6. เมื่อ sidebar ถูกย่อ (collapsed) ถ้ามีโหมดนี้: แสดงเฉพาะรูปโล่ (crop ส่วนโล่จากภาพเดียวกัน) แทนโลโก้เต็ม
7. ลบ CSS ของ `.sms-brand-copy` ที่ไม่ได้ใช้แล้ว (เฉพาะจุดที่เลิกใช้) และอัปเดต source-contract test ที่ล็อกข้อความ "SMS"/"Security Management System" ใน shell

**Acceptance criteria**
- [ ] 1366×768 และ 375×812, ธีมสว่างและมืด: ทั้ง 6 จุดเป็นภาพโลโก้ใหม่ ไม่มีตัวหนังสือ HTML ซ้ำ ไม่ถูกตัด ไม่ผิดสัดส่วน
- [ ] พื้นเข้มใช้ไฟล์ `-dark`, พื้นสว่างใช้ไฟล์ปกติ — รวมหน้าสาธารณะและแผงซ้ายของ Login ที่เป็นพื้นเข้มแม้ในธีมสว่าง
- [ ] สลับธีมแล้วโลโก้ไม่กระโดด (ความสูงเท่ากัน)
- [ ] ไม่มี layout shift ตอนโหลด (กำหนด width/height)
- [ ] ไฟล์ใช้งาน ≤ 25 KB

---

## Checklist ตรวจรับ (สำหรับเจ้าของงาน)

- [ ] PR base ไม่ใช่ `main` (ต้องเป็น integration branch ที่ staging ใช้)
- [ ] diff อยู่ในขอบเขต Task
- [ ] test / build ผ่านใน CI
- [ ] เปิด Preview ทดสอบตาม Acceptance criteria ทีละข้อ (มือถือจริงสำหรับ T02, T06, T13)
- [ ] Console ไม่มี error
- [ ] ส่ง Preview URL ให้ Claude รีวิวซ้ำ
