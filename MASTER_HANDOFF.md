# MASTER HANDOFF

อัปเดต 6 ตุลาคม 2569 (UTC)

## สถานะปัจจุบัน

- Integration base `fix/serverless-database-reliability` หลัง Phase B: `3ed0585567091e88135bdbc3f7087a589c30e7d4`; SHA นี้มีเฉพาะ Vercel Preview deployment ของ branch.
- Canonical `sms-v3-staging-ten.vercel.app` ยังรัน `f63c785` โดยมี `VERCEL_ENV=production`; ยังไม่ได้ deploy integration SHA `3ed0585` ไปที่ canonical staging.
- เฟส A: ปิดรายการที่ระบุใน #470 และ #471 โดยไม่เปิด PR ใหม่.
- เฟส B: merge #470 → #471 → #472 → #473 เข้า integration branch ตามลำดับ; CI หลัง rebase ผ่านทุก PR. Integration SHA มี Preview deployment เท่านั้น; canonical staging ยังเป็น `f63c785` (`VERCEL_ENV=production`).
- เฟส C: เปิด PR แยกตามลำดับ T05 → T01 → T02 → T03 → T06. #474–#477 ผ่าน CI และ Vercel Preview READY; ไม่ merge. #478 เปิดแล้วและ Preview READY บน implementation SHA `cf45f3aadbde45a8855ca055526e1e52503dcb81`; CI ถูกหยุดที่ dependency audit ก่อนเริ่ม tests/build เพราะ `sharp` เวอร์ชันใน base ต่ำกว่าเวอร์ชันแก้ CVE. จึงยังไม่ผ่านเงื่อนไข CI ของ T06.
- ไม่มีการ deploy Production, promote, แตะ Environment approval หรือเขียนข้อมูลลงฐานข้อมูล staging/Production.

## เฟส A+B — PR ค้างและ integration

| PR | SHA ก่อน rebase | SHA หลัง rebase | CI หลัง rebase | Merged | Vercel Preview | Acceptance criteria |
|---|---|---|---|---|---|---|
| #470 | `80af2825a636f35cb5a3d1d6fe67b50efc631b80` | `26eeee832ea3e9cd0e6b0c171b46cd0680b9ac03` | `37457419185` ผ่าน | ใช่ — merge SHA `adb94c9135dbac9e0b94e3461869f7a7e8b20c10` | [READY](https://sms-v3-staging-git-fix-schedule-approval-stat-155f07-godzillazz.vercel.app) | ผ่าน: change type ครบ 12 labels; เหตุผลไม่อนุมัติหลัง trim ต้องยาวอย่างน้อย 5 ตัวอักษรและมี regression tests. |
| #471 | `739bb43590a89dbc696e4973d07bbbf90cc9ae6c` | `667666afc742df80aca1dac13dba666f47e240b4` | `37457947822` ผ่าน | ใช่ — merge SHA `da6b44d302abee0ff1dc5575164da03b966ea2ac` | [READY](https://sms-v3-staging-git-fix-schedule-department-ro-7ffe45-godzillazz.vercel.app) | ผ่าน: แถวแผนกเด่นและ sticky ในธีมสว่าง/มืด/print; ค่า department หลายค่าเช่น `AN1,AN2,AN3` คงเป็นค่าเดียวตามพฤติกรรมเดิม. |
| #472 | `06adee290b2fe2be4a359fdab2772a92d574f278` | `923447d7c7da6661463c64c2195dae01ad374cda` | `37458878815` ผ่าน | ใช่ — merge SHA `5a0fbe299bedd165a580995dc326b54e946aaaa3` | [READY](https://sms-v3-staging-git-fix-schedule-auto-preview-108969-godzillazz.vercel.app) | ผ่านจาก tests/build: preview คงข้อมูลเดิมและเติมเฉพาะช่องว่าง; path บันทึกไม่ลบ/แก้ assignment เดิม. |
| #473 | `2282dda340bef35ec830a46e53be5f7bd09a3a80` | `d8c8ad0706c5d7feb9b038c6dde8204f622c1235` | `37459833957` ผ่าน | ใช่ — merge SHA / integration base `3ed0585567091e88135bdbc3f7087a589c30e7d4` | [READY](https://sms-v3-staging-git-fix-schedule-batch-save-10-c701ee-godzillazz.vercel.app) | ผ่าน: batch save และ regression tests. เวลา 1,000 รายการยังไม่ได้วัดตามตัวเลือก (ข). |

สถานะ Vercel หลัง Phase B: integration SHA `3ed0585567091e88135bdbc3f7087a589c30e7d4` มี Preview deployment เท่านั้น. Canonical `sms-v3-staging-ten.vercel.app` ยังคงเป็น `f63c785` (`VERCEL_ENV=production`).

## เฟส C — PR แยกตาม task (ยังไม่ merge)

| Task | PR | SHA | CI | Vercel Preview | Acceptance criteria |
|---|---|---|---|---|---|
| T05 | #474 | `917e158dcf325481789595415bc9a65d1661cf37` | `37465310567` ผ่าน | [READY](https://sms-v3-staging-git-fix-ux-t05-schedule-approv-752411-godzillazz.vercel.app) | ผ่าน: นับเฉพาะ revision ล่าสุดและแสดงคิวอนุมัติตามประเภทคำขอ. |
| T01 | #475 | `116dd0a92b7377a2b570d09f144f8f3b4215cd61` | `37470176135` ผ่าน | [READY](https://sms-v3-staging-git-fix-ux-t01-loading-state-n-77d77f-godzillazz.vercel.app) | ผ่าน: loading state ผูกกับ page/query ปัจจุบันและไม่แสดงค่าค้าง. |
| T02 | #476 | `b817d8a9eaa4c148c6541e2a399b3d5338732ab0` | `37474817059` ผ่าน | [READY](https://sms-v3-staging-git-fix-ux-t02-attendance-page-e7112f-godzillazz.vercel.app) | ผ่าน: contrast และข้อความสถานะ/ข้อผิดพลาดภาษาไทย; mobile layout ผ่าน fixture. |
| T03 | #477 | `6b6a488462f2098f79d47cc7470ec968dbc98bfa` | `37482896586` ผ่าน | [READY](https://sms-v3-staging-git-fix-ux-t03-remove-dev-copy-dfd2f3-godzillazz.vercel.app) | ผ่าน: ลบข้อความ/การ์ด placeholder ที่ไม่มีความสามารถรองรับ; ตรวจ browser fixture ที่ 1366×768 และ 375×812. |
| T06 | #478 | `cf45f3aadbde45a8855ca055526e1e52503dcb81` (implementation SHA) | `37486534701` ไม่ผ่านที่ `npm audit`; tests/build ถูกข้าม | [READY](https://sms-v3-staging-git-fix-ux-t06-login-20261006-godzillazz.vercel.app) | ผ่านในเครื่อง: 839 frontend tests, build, browser smoke ที่ 1366×768/375×812, Lighthouse Accessibility 100. CI acceptance ยัง blocked. |

ทุก PR เฟส C ยังเปิดอยู่และไม่ merge.

## T22 benchmark

เลือกข้อ (ข): งด benchmark รอบนี้; เกณฑ์ 15 วินาทีรอวัดจากการใช้งานจริงบน staging. ไม่มีการสร้างหรือลบข้อมูลทดสอบในฐานข้อมูลใด.

## Blockers / การตัดสินใจจากเจ้าของระบบ

- T06 CI `37486534701` ล้มที่ root `npm audit --audit-level=high`: `sharp <0.35.5` มี high severity advisory `CVE-2026-96889` (`GHSA-wq5f-xc86-pv6w`). CI ยังไม่เริ่ม tests/build. ไม่มี package/dependency change ใน T06; ต้องตัดสินใจว่าจะอัปเดต dependency ในงานแยกหรือแก้ที่ base ก่อน จึงจะผ่าน CI gate ได้.
- T03 มีบันทึก G06 UAT ที่ระบุว่า owner-authorized test data ใช้สำหรับ demo; เจ้าของระบบต้องยืนยันข้อมูล UAT บน staging ก่อนมีการทดสอบข้อมูลจริง. ไม่มีการเขียน staging DB.
- T22 ไม่มี benchmark; เกณฑ์ 15 วินาทีรอวัดจากการใช้งานจริงบน staging ตามตัวเลือก (ข).
