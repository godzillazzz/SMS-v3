# SMSv3 — Figma Design System Integration Plan

สถานะเอกสาร: สำรวจและวางแผนเท่านั้น
ขอบเขต: Figma และ source code ใน SMS-v3/frontend แบบอ่านอย่างเดียว ก่อนเสนอการปรับ UI
Production: ไม่มีการแก้ไขหรือ deploy

## ขอบเขตและหลักฐาน

- Figma: [SMSv3 Design](https://www.figma.com/design/YxyqOogV1IbcQ3yya9esKh/Untitled?node-id=2-8383)
- เฟรมที่เปิดจากลิงก์: F1 สีและธีม 2:8383; ตรวจโครงสร้างหน้า 0:1 ผ่าน Figma MCP
- React ปัจจุบัน: React + TypeScript + Vite ใน frontend/src; entry และ state ของหน้าอยู่ใน frontend/src/main.tsx
- ตรวจไฟล์และ CSS ใน workspace รวม frontend/src/design-system.css, frontend/src/styles.css, frontend/src/styles/responsive-shell.css และ component/page modules
- ลองเปิด Production แบบอ่านอย่างเดียว แต่ network tunnel ตอบ 403 CONNECT tunnel failed และ browser MCP เชื่อมต่อไม่สำเร็จ ดังนั้น coverage ด้านล่างอ้างอิง source code ใน workspace ไม่ใช่การยืนยันหน้าจอ Production หรือข้อมูลหลัง login. การขอ design context แยกของ P3 ต่อมาถูก Figma MCP ปฏิเสธเพราะถึง Starter-plan tool-call limit; ใช้โครงสร้างและ annotation ของ P3 ที่ติดมากับ metadata หน้าเดิม และไม่ได้รับ screenshot แยก

### Figma references ที่เพิ่มภายหลัง

| ไฟล์ | ลิงก์ | สถานะ |
| --- | --- | --- |
| Attendance-Figma | [เปิดไฟล์](https://www.figma.com/design/kju2TfQSQXIZK5W54gC35z/Attendance-Figma) | รออ่าน; URL นี้ถูกส่งมาซ้ำ 2 ครั้ง นับเป็นไฟล์เดียว |
| SMS-v3 UX Audit Flow Wireframe | [เปิดไฟล์](https://www.figma.com/design/MOFCUfthR4wKx4Iq0T0eXd/SMS-v3_UX-Audit-Flow-Wireframe_Figma-SVG) | รออ่าน |
| Landing-Page | [เปิดไฟล์](https://www.figma.com/design/6C11zFm0xH0drax45HXFsl/Landing-Page) | ผู้ใช้กำหนดให้เป็นแหล่งอ้างอิงสำหรับ Login/Landing; รออ่านก่อน implement |

การอ่านทั้งสามไฟล์ผ่าน Figma MCP ถูกปฏิเสธด้วยข้อความ `You've reached the Figma MCP tool call limit on the Starter plan`; `whoami` ยืนยันว่าแผนปัจจุบันเป็น Starter และมี seat แบบ View. จึงยังไม่มีหลักฐานเรื่อง frames, tokens, components หรือ flow จากไฟล์เหล่านี้ และไม่ได้อนุมานรายละเอียดดีไซน์. ต้องอ่านใหม่เมื่อมีโควตาหรือสิทธิ์เข้าถึงแล้ว.

ตามคำสั่งล่าสุด ให้ใช้ไฟล์ Landing-Page เป็นแหล่งอ้างอิงของ Login/Landing. ขณะนี้ยังอ่านรายละเอียดจาก Figma MCP ไม่ได้ จึงยังไม่มีการ implement หรือเปลี่ยนหน้าเหล่านี้. PR4 ที่มี Login/Dashboard พักรอการอ่านแบบ; PR1 ที่เปิดอยู่เปลี่ยนสี accent ของ Login จึงยังไม่ควรรวมจนกว่าจะตรวจเทียบกับแหล่งอ้างอิงที่ผู้ใช้กำหนด.

## สรุปผลการอ่าน Figma

เอกสารมี 1 หน้า และ 39 เฟรมระดับบน: ปก 1, หน้าจอ desktop 27, Foundations 4, mobile 4 และ print 3. ในหน้าเดียวมี 19,230 nodes ได้แก่ FRAME 39, GROUP 4,462, VECTOR 7,957 และ TEXT 6,772.

Figma MCP ตรวจพบ COMPONENT / COMPONENT_SET / INSTANCE = 0, local Variables และ variable collections = 0, local paint/text/effect/grid styles = 0 และ prototype reactions = 0. เฟรมระดับบนทั้งหมดใช้ layoutMode=NONE และ constraints MIN/MIN; เนื้อหาส่วนใหญ่เป็นกลุ่ม vector กับ text ที่จัดตำแหน่งตายตัว. ดังนั้น F1–F4 เป็น reference boards ที่แสดงค่าดีไซน์ ไม่ใช่ library ของ Figma variables/components ที่ bind แล้ว. UX flow ในเอกสารนี้สรุปจากลำดับหน้าจอและ annotation บนบอร์ด ไม่ได้มาจาก prototype links.

### Frame inventory

- **ปกและหลักการ:** 00-cover
- **Desktop:** 01-login, 02-register, 03-dashboard, 03b-dashboard-viewas, 04-personnel, 05-employee-form, 06-licenses, 07-schedule, 08-shift-setup, 09-shift-editor, 10-auto-preview, 11-wand, 12-approvals, 13-leave-request, 14-leave-pending, 15-leave-history, 16-quota, 17-rules, 18-audit, 19-users, 20-summary, 21-settings, 22-appearance, 23-command-palette, 24-dashboard-dark, 25-schedule-dark, 26-dashboard-teal
- **Foundations:** [F1 สีและธีม](https://www.figma.com/design/YxyqOogV1IbcQ3yya9esKh/Untitled?node-id=2-8383), [F2 ตัวอักษร/รูปทรง/ไอคอน](https://www.figma.com/design/YxyqOogV1IbcQ3yya9esKh/Untitled?node-id=2-7910), [F3 Components](https://www.figma.com/design/YxyqOogV1IbcQ3yya9esKh/Untitled?node-id=2-11449), [F4 เมนูและสิทธิ์](https://www.figma.com/design/YxyqOogV1IbcQ3yya9esKh/Untitled?node-id=2-8913)
- **Mobile:** M1-mobile-dashboard, M2-mobile-schedule, M3-mobile-leave, M4-mobile-nav
- **Print:** P1-print-leave, P2-print-schedule, P3-print-register

## Design tokens กลางจาก Figma

ค่าต่อไปนี้อ่านจากข้อความและตัวอย่างบน F1/F2 โดยตรง; ไม่พบ Figma Variables หรือ Styles ที่นำเข้าได้

### สี accent: 3 ธีม × 2 โหมด

| ธีม | โหมด | brand | brand-600 | brand-soft | sidebar ink | gradient |
| --- | --- | --- | --- | --- | --- | --- |
| Navy | สว่าง | #1D4ED8 | #1E40AF | #E8EEFD | #0E1A31 | #38BDF8 → #6366F1 |
| Navy | มืด | #86A8FF | #A9C1FF | #18264A | #0C131F | #38BDF8 → #818CF8 |
| Teal | สว่าง | #0B7A74 | #086561 | #E2F4F2 | #0C2A31 | #2EC5F0 → #29C39B |
| Teal | มืด | #4FD1C5 | #81E0D6 | #0F2D2C | #0A1517 | #2EC5F0 → #29C39B |
| Emerald | สว่าง | #047857 | #036349 | #E1F5EC | #0E2A20 | #34D399 → #A3E635 |
| Emerald | มืด | #4ADE9B | #7EE9B8 | #0F2A1F | #0A1511 | #34D399 → #A3E635 |

### Neutral และ semantic

| Token | สว่าง | มืด |
| --- | --- | --- |
| bg | #F3F5F9 | #0A0F17 |
| surface | #FFFFFF | #111925 |
| sunk | #F7F9FC | #0D141E |
| track | #E8ECF2 | #1C2635 |
| border / border-strong | #E2E7EF / #C9D2DE | #212D3E / #33435A |
| text / text-soft / muted | #111A2C / #43506A / #5D6A80 | #E8EDF5 / #B6C1D3 / #93A0B5 |

Semantic colors ใช้ความหมายเดิมทุกธีม; เปลี่ยนค่าสีสำหรับ dark mode:

| ความหมาย | สว่าง | มืด | ใช้กับ |
| --- | --- | --- | --- |
| success | #0E7A42 | #4ADE80 | อนุมัติ / ใช้งานได้ |
| warning | #8F5300 | #FBBF24 | รอ / ใกล้หมดอายุ |
| danger | #B42318 | #F87171 | ไม่อนุมัติ / หมดอายุ / ลบ |
| info | #0A68A0 | #60A5FA | ข้อมูล / แก้ไข |
| neutral | #475467 | #B6C1D3 | ยกเลิก / ปิดใช้ |
| violet | #6D28D9 | #C4B5FD | บทบาทผู้ดูแล / รีเซ็ตรหัสผ่าน |

F1 ระบุให้สถานะมีข้อความและสัญลักษณ์ร่วมกับสีเสมอ และแสดงค่าที่ไม่มีใน enum map เป็นโทนกลางโดยไม่สร้างสถานะใหม่. คู่ข้อความ/พื้นหลังที่ระบุในบอร์ดผ่าน WCAG AA 4.5:1.

### กะและเอกสารพิมพ์

| รหัสกะ | สีข้อมูล | สีข้อความสว่าง | สีข้อความมืด |
| --- | --- | --- | --- |
| D | #2563EB | #235EDF | #719AF2 |
| N | #7C3AED | #7C3AED | #AA7FF3 |
| S | #0D9488 | #0A766D | #4AAFA6 |
| OFF | #94A3B8 | #606A78 | #A4B1C3 |
| AL | #D97706 | #985304 | #E19238 |

สีข้อมูลของกะมาจาก ShiftType.color และไม่เปลี่ยนตามธีม; Figma ให้ปรับเฉพาะสีข้อความให้ contrast ผ่านเกณฑ์.

| Document token | ค่า |
| --- | --- |
| doc-ink | #0F1B33 |
| doc-text | #1F2937 |
| doc-soft | #4B5563 |
| doc-rule | #9CA3AF |
| doc-accent | #1E3A8A |
| doc-void | #B42318 |

เอกสารพิมพ์ใช้สีแบบกระดาษ ไม่รับ theme หรือ dark mode.

### Typography และ geometry

- หน้าจอ: IBM Plex Sans Thai, weight 400/500/600/700; รหัสและตัวเลข: IBM Plex Mono; เอกสารพิมพ์: Sarabun.
- Type scale ที่ระบุ: Display 40/700, H1 26/700, KPI 30/700, H2 16/600, Body/Table 14/400, Caption และ Eyebrow 12.5, Badge 12/600, Mono 13/500. ตัวเลขในตารางใช้ tabular figures.
- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 48 px.
- Radius: card 14 px, button/input 10 px, small button 8 px, shift chip 6 px.
- Elevation: shadow-sm สำหรับ card, shadow-md สำหรับ popover, shadow-lg สำหรับ dialog/drawer/toast.
- Focus: ring 3 px สีหลักที่ opacity 18% พร้อม edge 1.5 px.
- Touch target: มือถืออย่างน้อย 44 px; ปุ่มปกติ 40 px; ปุ่มเล็ก 32 px.
- Layout reference: sidebar 248 px, collapsed rail 76 px, topbar 64 px, content inset 32 px, card gap 16–20 px.
- ไอคอนเป็นเส้น 1.75 px, ปลายมน และใช้ currentColor; F2 มีชื่อไอคอนอย่าง home, calendar, users, shieldcheck, search, menu, moon, sun, printer และ wand.

## Component Inventory และ React mapping

| กลุ่ม Figma | Inventory จาก F3/F4 | React ปัจจุบัน | Mapping / gap |
| --- | --- | --- | --- |
| App shell | Sidebar ตาม role, active item, collapsed rail, topbar, breadcrumb, user menu | navigation, sidebar/topbar ใน main.tsx; responsive-shell.css | โครงสร้างมีแล้ว แต่ glyph icons และ layout/style ปัจจุบันไม่ใช่ชุด Figma; ตรวจ rail และ role menu ให้ตรงโดยคง permission เดิม |
| Buttons | primary, secondary, ghost, success, danger, danger-outline, icon-only, disabled, loading | CSS classes .btn-*, ปุ่มใน page modules | มีรูปแบบ CSS หลายชุดและ inline styles; ยังไม่มี React primitive กลาง |
| Form controls | text/email/password/select, focus/error/hint/disabled, leading/trailing icon, checkbox, radio, toggle, segmented control | Login, EditDialog, ShiftEditorModal, LeaveManagementPage, access dialogs; .field-group | behavior มี แต่ markup/state styling กระจายตาม feature |
| Status | Badge map สำหรับ leave, approval, license, account, employee, rule, check, match, severity; ค่าไม่รู้จักเป็น neutral | .status-badge, shift badges และ status rendering ใน OperationalTable/ตารางเฉพาะ | รวม mapping ภาพไว้กลางได้ โดยคง enum และข้อความเดิม |
| Cards / feedback | KPI, attention card/row, info alert, success/error toast, loading/empty/error | DashboardPage, components/dashboard/*, ErrorAlert, page-specific empty states | มี card และ state หลายแบบ; dashboard ปัจจุบันยัง render RecentActivityCard กับ DataSyncStatusCard แต่ Figma 03 ระบุให้ตัด placeholder ที่ไม่มีข้อมูลรองรับ |
| Tables | header/row/avatar/actions, pagination, empty state, tooltip, keycap, filters | PersonnelTable, AuditTable, AccountTable, OperationalTable | มี table implementations หลายชุด; สร้าง shared styling/primitive แล้วคง columns/actions/callbacks ของแต่ละหน้า |
| Schedule cells | D/N/S/OFF/AL, draft, override, deleted/locked, save-draft bar | schedule grid และ drafts ใน main.tsx; ShiftEditorModal; shift setup table | logic เดิมมีอยู่; map เฉพาะการแสดงผลและ breakpoint ให้ตรงกับ F3/M2 |
| Dialog / drawer | confirm dialog, editor, detail drawer, full-screen modal บนมือถือ | EditDialog, ShiftEditorModal, EmployeeMagicWandModal, PersonnelDetailDrawer, AccountDrawer, AuditEventPreview | ปรับ shared surface/focus/size ได้โดยไม่แตะ callback หรือ business rules |
| Icon set | named SVG icons จาก F2/F3 | glyph เช่น ⌂, ♙, ▣ ใน main.tsx และ page components | ควรเพิ่ม Icon adapter และแทน glyph เฉพาะจุดที่มี asset ตรงกัน; ห้ามเปลี่ยนความหมายของ action |

## Mapping หน้าจอและ coverage ปัจจุบัน

สถานะนี้หมายถึงการพบ implementation ใน source code; **ไม่ใช่การยืนยัน visual parity หรือการเปิดดู Production**.

| Figma frame | React mapping | Source coverage |
| --- | --- | --- |
| 01 login | Login + AuthProvider ใน main.tsx | มี |
| 02 register | Login modes สำหรับ registration และ OTP | มี |
| 03 dashboard | DashboardPage, components/dashboard/* | มี; ยัง render RecentActivity/DataSync ที่ Figma ให้ตัดออก |
| 03b dashboard-viewas | AuthProvider.beginViewAs, users flow และ read-only banner | มี |
| 04 personnel | PersonnelDirectoryPage, components/personnel/* | มี |
| 05 employee-form | openEmployeeEditor + EditDialog ใน main.tsx | มีเป็น dialog; ไม่ใช่หน้าฟอร์มแยก |
| 06 licenses | OperationalTable / tablePages | มี |
| 07 schedule | schedule branch/grid ใน main.tsx | มี |
| 08 shift-setup | shift type table ใน main.tsx | มี |
| 09 shift-editor | ShiftEditorModal | มี |
| 10 auto-preview | previewAutoSchedule และ preview state ใน schedule branch | มี |
| 11 wand | EmployeeMagicWandModal / employee schedule wizard | มี |
| 12 approvals | OperationalTable และ approval actions | มี; เข้าจาก related flow ไม่ใช่ item หลักใน navigation |
| 13 leave-request | LeaveManagementPage mode all | มี |
| 14 leave-pending | LeaveManagementPage mode pending | มี |
| 15 leave-history | LeaveManagementPage mode history | มี |
| 16 quota | OperationalTable | มี |
| 17 rules | OperationalTable | มี |
| 18 audit | AuditCompliancePage, AuditTable, AuditToolbar, AuditEventPreview | มี |
| 19 users | AccessManagementPage, account table/drawer/dialogs | มี |
| 20 summary | reports branch แสดง metric totals ใน main.tsx | บางส่วน; เป็น summary cards ไม่ใช่ report workspace แยก |
| 21 settings | SettingsPage ใน main.tsx | บางส่วน; system values และ LINE templates |
| 22 appearance | ไม่พบหน้าเลือก theme/mode หรือ data-theme preference | ขาด |
| 23 command-palette | ไม่พบ Ctrl+K palette; topbar search ปัจจุบันค้นพนักงาน | ขาด |
| 24 dashboard-dark / 25 schedule-dark / 26 dashboard-teal | CSS ปัจจุบันมี palette เดียว | ขาด theme variants |
| M1–M4 mobile | responsive-shell.css มี responsive shell/drawer และ breakpoint 1024/760 px | บางส่วน; ต้องเทียบ KPI 2×2, 44 px rows, sticky schedule name/draft bar, 48 px leave controls และ safe-area |
| P1 print-leave | LeavePrintDocument + print CSS | มี print flow; typography/token parity ยังไม่ตรงโดยตรง |
| P2 print-schedule | printData, .print-only, print table และ window.print() | มี print flow; ต้องเทียบรูปแบบกระดาษกับ Figma |
| P3 print-register | ใบอนุญาตใน OperationalTable + generic window.print() | บางส่วน; Figma ระบุ A4 แนวนอน, letterhead, ทุกหน้า, เงื่อนไขกรอง, ตัดคอลัมน์ action และ status ขาวดำตัวหนา |

### UX Flow จากลำดับหน้าจอและ annotation

1. **เข้าสู่ระบบ:** 01 Login → 02 Register/ยืนยัน OTP → กลับเข้า Login. Source ยังมี reset-password OTP เพิ่มเติม.
2. **งานผู้ดูแล:** 03 Dashboard → บุคลากร/ใบอนุญาต → ตั้งค่ากะ → ตารางกะ → แก้ไขหรือสร้าง preview/ใช้ wand → ส่งอนุมัติ → 12 Approvals. 03b เป็น read-only View-As.
3. **การลา:** 13 ยื่นคำขอ → 14 รออนุมัติ → อนุมัติ/ไม่อนุมัติ → 15 ประวัติ และดู 16 โควตา.
4. **กำกับดูแล:** 17 Rules, 18 Audit, 19 Users/Roles และ 20 Summary.
5. **การแสดงผล:** user menu → 22 Appearance → เลือก accent/mode และดู preview; 23 เปิด command palette จาก Ctrl+K. สองหน้าจอนี้ยังไม่มี implementation ใน source.
6. **มือถือและเอกสาร:** M1 dashboard, M2 ตารางกะ, M3 ยื่นลา, M4 drawer; P1/P2 พิมพ์ใบลาและตารางกะ; P3 พิมพ์ทะเบียนใบอนุญาต รปภ. จากตาราง โดยแสดงข้อมูลครบทุกหน้าและเงื่อนไขกรอง.

## จุดต่างที่ควรแก้ในแผน integration

- CSS ปัจจุบันใช้ indigo #5746D9 เป็น primary และ #F5F7FB/#14213D/#667085/#E4E8F0 เป็น page/text/muted/border; Figma default Navy ใช้ #1D4ED8 และ neutral #F3F5F9/#111A2C/#5D6A80/#E2E7EF.
- styles.css และ design-system.css มี token ซ้ำ/หลายชื่อ; ไม่มี token layer แยก accent, neutral, semantic และ document ตาม Figma.
- CSS ปัจจุบันระบุ sidebar 244 px, content padding 28 px, card radius 12 px; Figma ระบุ 248 px, inset 32 px และ card radius 14 px. Topbar 64 px ตรงกับ reference.
- frontend/package.json มี IBM Plex Sans Thai และ IBM Plex Mono แต่ไม่พบ Sarabun; print fonts จึงยังต้องจัดให้ตรง F2.
- Figma 03 ระบุให้เอา RecentActivity/DataSync placeholder ออกจาก dashboard; DashboardPage.tsx ยัง render ทั้งสอง component. เป็น UI mismatch ที่ควรตรวจและแก้เฉพาะ presentation.
- ปัจจุบันมี CSS responsive shell แต่ Figma M1–M4 เป็น behavior เฉพาะหน้า; ต้อง implement ตาม annotation ไม่ใช้การย่อ desktop frame แทน mobile layout.

## แผน PR ย่อย

| PR | ขอบเขต | ผลลัพธ์/เกณฑ์รับ |
| --- | --- | --- |
| PR1 — Token foundation | รวม token ซ้ำใน design-system.css/styles; สร้าง accent × mode, neutral, semantic, shift, document tokens และ typography/spacing/radius/elevation/focus | Navy-light เป็นค่าเริ่มต้น; Teal/Emerald + dark mode ใช้ token เดียวกัน; print ไม่รับ dark theme; ไม่มีการเปลี่ยน API |
| PR2 — Shared primitives | เพิ่ม/รวม Button, Icon, Field, Badge, Card, Alert/Toast, Table, EmptyState, Pagination และ dialog surface | component รับ props/callback เดิมได้; ทุก state จาก F3 มีตัวแทน; status แสดงไอคอน/ข้อความร่วมกับสี |
| PR3 — Shell, navigation, appearance entry | ปรับ Sidebar/rail, topbar/breadcrumb/user menu, responsive drawer; เพิ่ม appearance controls และ Ctrl+K palette สำหรับ route ที่มีอยู่ | คง navigation, role visibility, read-only View-As และ logout behavior; appearance เก็บเฉพาะ preference ฝั่ง browser; palette ซ่อน route ที่ role เข้าไม่ได้ |
| PR4 — Auth + dashboard (พักรออ่าน Figma) | ใช้ Landing-Page เป็นแหล่งอ้างอิง Login/Landing ตามคำสั่งล่าสุด; อ่านดีไซน์ก่อนเริ่มแก้ UI | PR #687 คงแยกและยังไม่รวม; auth/OTP และ dashboard callbacks เดิมต้องคงเดิมเมื่อเริ่มงานภายหลัง |
| PR5 — Data/admin views | Personnel, licenses, rules, approvals, audit, users และ summary/settings tables | ใช้ surface/table/status กลาง; คง columns, actions, permission guards และ callbacks เดิม; employee form ยังใช้ flow เดิม |
| PR6 — Schedule workflow | Schedule grid, shift setup/editor, auto-preview, wand, approval states และ draft bar | map D/N/S/OFF/AL และ override/draft states ตาม F3; คง payload, validation, save/approval logic และ export เดิม |
| PR7 — Leave workflow | Request, pending, history, quota และ attachment/approval surfaces | คงเงื่อนไขลา, validation, attachment/API และ approval logic; มือถือมี controls/submit area ตาม M3 |
| PR8 — Mobile parity | M1–M4: app bar/drawer, 2×2 KPI, row hit area 64 px, schedule horizontal scroll/sticky employee/draft safe-area, leave controls 48 px/sticky submit | ทดสอบที่ viewport อ้างอิง ~390 px และ tablet; ไม่มี horizontal overflow นอกตารางที่ตั้งใจเลื่อน |
| PR9 — Print parity | P1/P2/P3 paper styles และ Sarabun; ทำ P3 เป็นแม่แบบพิมพ์ตาราง A4 แนวนอนร่วมกันสำหรับใบอนุญาต/ลา/กฎ/ผู้ใช้/Audit; ใช้ข้อมูลและ API เดิมให้ครบทุกหน้า พร้อม filter note, เลขแถว, header ซ้ำ, ไม่มี action column และ status ขาวดำตัวหนา | document tokens คงที่; print preview แยกจาก theme; ใช้เฉพาะข้อมูล/ตัวกรองที่มีอยู่ โดยไม่เปลี่ยน API contract หรือ business action |

## Guardrails สำหรับทุก PR

- เปลี่ยนเฉพาะ presentation/component composition; ห้ามแก้ API, Database, Auth, RBAC, validation, business rules หรือ workflow semantics.
- Login/Landing ต้องอ้างอิงไฟล์ Landing-Page ที่ผู้ใช้ระบุ; ห้ามคาดเดาดีไซน์หรือแก้หน้าเหล่านี้ก่อน Figma MCP อ่านไฟล์ได้.
- คง handler, props, payload, route IDs และ role checks ที่มีอยู่; UI ใหม่ของ appearance/palette ต้องเป็น client-side และเปิดเฉพาะหน้าที่ผู้ใช้เข้าถึงได้แล้ว.
- ใช้ screenshot/reference Figma ที่เกี่ยวข้องประกอบ review สำหรับ desktop และ mobile; ถ้า annotation ขัดกับพฤติกรรมจริงให้หยุดที่ UI mapping และยกประเด็นก่อนแตะ logic.
- งานนี้ไม่แก้ Production, ไม่เขียนข้อมูลจริง และไม่ deploy. การเปิด Production ยังไม่ได้รับการยืนยันเพราะ network access ถูก proxy ปฏิเสธ.
