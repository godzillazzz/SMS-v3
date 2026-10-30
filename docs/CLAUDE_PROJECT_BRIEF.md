# SMS-v3: สรุปโครงการสำหรับส่งต่อให้ Claude

> อัปเดต: 30 ต.ค. 2569 (2026-10-30)
> ผู้สรุป: FORGE (AI coding agent)
> ใช้เป็นบริบทเริ่มต้นของ Claude ก่อนทำงานต่อ
> ห้ามใส่ secret, token หรือ password ลงในไฟล์นี้

---

## 1. โครงการนี้คืออะไร

**SMS-v3 (Security Management System V.3)** เป็นระบบบริหารงานรักษาความปลอดภัย (รปภ.) ของบริษัท ผู้ใช้หลักคือเจ้าหน้าที่ความปลอดภัยของบริษัท

**ขอบเขตธุรกิจ**
- พนักงานรักษาความปลอดภัยประมาณ 61–63 คน
- 19 Site/แผนก
- ประมาณ 95 จุดตรวจ

**ฟังก์ชันที่มีอยู่แล้ว**
- ทะเบียนพนักงาน และใบอนุญาต รปภ. (ธภ.7) พร้อมเอกสารแนบ
- ตารางกะรายเดือน: รหัสกะ, จัดกะอัตโนมัติ, อนุมัติตารางกะ, ส่งออก Excel/PDF
- การลา: คำขอลา, อนุมัติ, โควตา, พิมพ์ใบลา
- ลงเวลาเข้า-ออก
  - ใช้ GPS/Geofence และ Device binding
  - การย้ายอุปกรณ์ต้องให้ ADMIN อนุมัติ
  - มีโหมด offline ที่ปลอดภัย และ PWA บนมือถือ
- ศูนย์ควบคุมการลงเวลาสำหรับหัวหน้า
  - ตารางสถานะประจำวัน, ประวัติ, คำขอแก้ไขเวลา
  - รายงานประจำวัน และ Monthly Timesheet
- ศูนย์อนุมัติรวม
- รายงานและวิเคราะห์ (Report Center)
  - ภาพรวมผู้บริหาร, รายละเอียด, แท็บส่งออก
- จุดรักษาความปลอดภัย (Security Site) และ QR ของ Site
- Audit log, Data quality, System health, ตั้งค่าระบบ

**ข้อห้ามด้านการออกแบบ:** ห้ามนำการลงเวลาด้วย Face หรือ QR กลับมา เพราะถูกถอดออกโดยตั้งใจ ส่วน QR สำหรับตรวจจุด (Patrol) เป็นคนละเรื่องกับการลงเวลา

---

## 2. เทคโนโลยี

**Backend**
- Node.js 22, Express 5
- Prisma 6.12 + PostgreSQL
- zod, multer, sharp
- Object storage แบบ S3/MinIO (`STORAGE_PROVIDER=s3` บน Production) หรือ Supabase

**Frontend**
- React 18, Vite 8, TypeScript 5.9
- Vitest และ Playwright
- jsqr และ qrcode
- ไม่ใช้ UI framework: CSS เขียนเอง ภาษาไทยทั้งระบบ

**ระบบเก่าที่เลิกใช้แล้ว:** เคยใช้ Vercel + Supabase ปัจจุบัน Production เป็น self-hosted

**Repository:** GitHub `godzillazzz/SMS-v3`

---

## 3. สภาพแวดล้อมและการ Deploy

**Production**
- URL: `https://sms.xvela.app`
- Server: self-hosted, ssh alias `sms-v3-selfhost`, service systemd `sms-v3`
- Release อยู่ที่ `/srv/sms-v3/releases/sms-v3-<SHA>`
- Symlink ที่ใช้งานจริง: `/srv/sms-v3/.current`
- Symlink ที่ชี้ต่อ: `/opt/sms-v3/app` และ `/var/www/sms`
- ห้ามแก้ path เหล่านี้ด้วยมือ และห้ามแก้ `/opt/sms-v3/shared/app.env`

**ขั้นตอน Deploy** ใช้สคริปต์ในรีโป โดยรันบน server ใน `/srv/sms-v3-checkout/.worktrees/owner-mobile-print-approval`

1. Build:
   ```
   node scripts/self-hosted-release.js build --repo /srv/sms-v3-checkout --output /srv/sms-v3/releases --sha <SHA> --identity forge@sms-mick --previous-release <release เดิม>
   ```
2. Verify แล้วรัน cutover แบบ dry-run ด้วยพารามิเตอร์ชุดเดียวกัน:
   ```
   --release ... --trusted-manifest-sha256 ... --rollback-target ... --trusted-rollback-manifest-sha256 ... --parent-boundary /srv --rollback-parent-boundary /srv --repo /srv/sms-v3-checkout
   ```
3. Cutover จริง: เพิ่ม `--apply --operator-gate I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER`
4. ตรวจหลัง deploy ว่า `/api/v1/health`, `/api/v1/ready`, `/` และ `/app` ตอบ 200 และดูชื่อไฟล์ bundle ใน `index.html`

**CI**
- Workflow `.github/workflows/ci.yml` มี 3 jobs: `validate`, `t22-schedule-benchmark`, `minio-real-integration`
- การ push branch ไม่ trigger CI อัตโนมัติ ต้องสั่งเอง:
  ```
  gh workflow run ci.yml --ref <branch> --repo godzillazzz/SMS-v3
  ```

---

## 4. สถานะปัจจุบัน (ยืนยันจริง 30 ต.ค. 2569)

**Production**
- รัน SHA `63e71a71ff45ddacf2e9f344cb55d923c1d6f4e5` และ health ตอบ 200
- จุด Rollback: release `sms-v3-31145f9a…`

**รอ Deploy:** SHA `e1d83e105649cfeb185f91da4de81703e18d3f9e` บน branch `fix/owner-attendance-print-ux`
- CI `40995511214` ผ่านครบ 3 jobs
- Build บน server แล้ว ได้ manifest `3e33dcbb76dae04e2d002cb861b019a79d6e92007cf44f998fa69997145aaa53`
- Verify และ dry-run ผ่าน
- ยังไม่ cutover เพราะรอ Owner สั่ง
- สิ่งที่แก้ใน SHA นี้:
  - แท็บส่งออกของ Report Center ดึงข้อมูลแบบแบ่งหน้า เดิมขอ pageSize=500 แต่ API จำกัดที่ 100
  - เพิ่มช่องเลือกพนักงานสำหรับพิมพ์ Timesheet รายบุคคล
  - ปรับ UI การ์ดส่งออกเป็นกลุ่ม
  - มี Playwright ทดสอบที่จอ 1366 และ 375

**กำลังทำ:** branch `feat/patrol-checkpoints` ที่ worktree `/root/sms-v3/.worktrees/owner-attendance-print-ux`
- ยังไม่ commit
- รายละเอียดอยู่ในข้อ 6

**Merge:** ยังไม่ merge เข้า `main` เพราะ Owner สั่งว่า "อย่าเพิ่ง Merge"

---

## 5. งานที่ทำเสร็จช่วงล่าสุด (deploy แล้ว)

**งานพิมพ์**
- ทะเบียนพนักงาน, Monthly Timesheet และรายงานการลงเวลาประจำวัน ใช้หัวกระดาษมาตรฐานเดียวกับใบลา (class `leave-print-header-redesign`)
- เลือกพิมพ์รายบุคคลได้ด้วย `employeeId` บน API `/attendance/supervisor/month-print`
- memoize site authority เพื่อแก้อาการพิมพ์ช้า 19–21 วินาที

**ตารางสถานะประจำวัน**
- แสดงแถวเดียว ไม่ต้องเลื่อนซ้ายขวา (`table-layout: fixed` + colgroup)
- ลดขนาดตัวอักษรและ padding
- ปุ่ม "รายงานวันนี้" เปิดหน้าต่างพิมพ์ทันที

**รายงานประจำวัน:** ถ้าพนักงานลงเวลานอก Site ของตัวเอง ให้แสดงชื่อ Site จริงที่ไปลงเวลา

**อื่น ๆ**
- ใบลา: แก้คำว่า "ลงชื่อ" ในกล่องอนุมัติที่หลุดลงไปด้านล่าง
- Legend ตารางกะ: ย้าย "สถานะช่อง" ขึ้นไปชิดแถว "รหัสกะ"
- เมนูรายงานเพิ่ม 5 ปุ่ม:
  - ส่งออกตารางกะ (Excel)
  - พิมพ์ทะเบียนพนักงาน
  - พิมพ์ทะเบียนใบอนุญาต รปภ.
  - พิมพ์ Timesheet รายบุคคล
  - พิมพ์ Timesheet ทั้งหมด
- รัน migration `202610290001_employee_private_contact` แล้ว (ที่อยู่และผู้ติดต่อฉุกเฉิน เห็นได้เฉพาะ ADMIN) โดยมี backup ก่อนรัน

---

## 6. งานที่กำลังทำ: ระบบสแกนจุดตรวจ (Patrol)

**ความต้องการของ Owner**
- รปภ. สแกน QR ที่จุดตรวจ และต้องถ่ายรูป 1 รูปต่อการสแกน 1 จุด ใช้กล้องหลังเท่านั้น ไม่ใช่ selfie
- สแกนจุดของแผนกอื่นได้
- มีระบบสร้างและพิมพ์ QR ของจุดตรวจ
- รายงาน 3 แบบ: รายแผนก, ทั้งหมดทุกแผนก และประจำวัน (คล้ายรายงานการลงเวลาประจำวัน)
- ทุกรายงานใช้หัวกระดาษมาตรฐาน
- มีเมนูแบบตารางกะ ไว้ดูว่าแผนกไหน จุดไหน ตรวจแล้วหรือยัง
- UI/UX ต้องดูดี

**ส่วนที่เขียนแล้ว (ยังไม่ commit)**

ฐานข้อมูล:
- เพิ่ม model `PatrolCheckpoint` และ `PatrolScan` ใน `prisma/schema.prisma`
- Migration `prisma/migrations/202610300001_patrol_checkpoints/migration.sql` เป็นแบบ additive คือสร้าง 2 ตารางใหม่ใน transaction และมี `rollback.sql`
- ทดสอบกับ Postgres ในเครื่องที่แยกจาก Production (DB `forge_patrol_test`) แล้ว ใช้ได้ ไม่เพิ่ม drift ใหม่ (drift ที่พบมีอยู่ก่อนแล้ว)
- อัปเดต `ATTENDANCE_SCHEMA_SHA256` ใน `scripts/ci/attendance-schema-pin.js` ตามกฎของไฟล์นั้น

Backend:
- `src/services/patrol.service.js`
  - checkpoint CRUD และ rotate QR สำหรับ ADMIN
  - QR payload รูปแบบ `SMSPATROL1:<token>`
  - recordScan มี idempotency ด้วย `clientScanId` และบังคับต้องมีรูป JPEG/PNG ขนาดไม่เกิน 1 MB
  - เก็บ GPS แบบไม่บังคับ
  - กำหนดวันทำงานตามเวลา Asia/Bangkok
  - report และ coverage รองรับช่วงไม่เกิน 62 วัน
  - myScans และ photo
- `src/services/patrol-storage.service.js`: เก็บรูปใน prefix `patrol-scan/` ของ bucket `PATROL_PHOTOS_BUCKET` ถ้าไม่ตั้งไว้จะใช้ `ATTENDANCE_DEVICE_SELFIE_BUCKET` จึงไม่ต้องสร้าง env ใหม่
- `src/routes/patrol.routes.js` mount ไว้ที่ `/api/v1/patrol`

Tests:
- `test/patrol.service.test.js` และ `test/patrol.routes.test.js` ผ่าน 13/13
- `test/integration/patrol.integration.test.js` ผ่าน 1/1 กับ Postgres จริง

Frontend ที่ `frontend/src/pages/patrol/`:
- `patrol-model.ts`: helper ที่เป็น pure function มี test 4/4
- `patrol-client.ts`
- `PatrolScanPage.tsx`: หน้าสแกนสำหรับ รปภ. บนมือถือ แบ่งขั้น QR → ถ่ายรูป → ยืนยัน และแสดงประวัติวันนี้
- `PatrolCenterPage.tsx`: แท็บสถานะ (grid แบบตารางกะ), แท็บจุดตรวจและ QR, แท็บพิมพ์รายงาน
- `PatrolPrint.tsx`: รายงาน 3 แบบ และแผ่น QR สำหรับติดจุด
- `patrol.css`

**สิ่งที่ยังไม่ได้ทำ**
1. ผูก route/menu ใน `frontend/src/routing.ts` และ `frontend/src/main.tsx`
   - เพิ่ม `patrol` (หน้าสแกน, ทุก role ที่ผูกกับพนักงาน)
   - เพิ่ม `patrolCenter` (สำหรับ ADMIN, MANAGER และ SUPERVISOR)
   - ควรเพิ่มปุ่มใน PWA bottom nav ด้วย แต่มี test ที่ล็อกไว้ว่ามี 5 แท็บ ต้องระวัง
2. เพิ่ม class `.patrol-report-print` และ `.patrol-qr-sheet` ให้ `preparePrintLayout` ใน `frontend/src/schedule-print.ts` แสดงผลตอนพิมพ์
3. รัน `tsc`, frontend test ทั้งชุด, backend `npm test` ทั้งชุด และ build + verify bundle
4. เขียน Playwright ทดสอบที่ 1366×768 และ 375×812 แล้วดู screenshot
5. Commit, push, รัน CI แล้ว build release
6. การขึ้น Production ต้องได้รับอนุมัติแยก 2 ขั้น:
   - อนุมัติให้รัน migration `202610300001_patrol_checkpoints`
   - อนุมัติให้ deploy SHA ที่ระบุ

---

## 7. กฎของ Owner (สำคัญมาก)

- สื่อสารภาษาไทย แต่ค่าทางเทคนิค เช่น SHA, path และคำสั่ง ให้คงเป็นภาษาอังกฤษ
- ทำงานต่อจนเสร็จ ห้ามหยุดเอง ถ้าต้องให้ Owner ตัดสินใจ ให้บอกเหตุผลแล้วลงท้ายว่า **«รอคุณสั่งการ»**
- ไม่ต้องรายงานความคืบหน้าทุก 3 นาที เพราะเปลือง token
- ถ้าข้อความมีคำว่า "(ยังไม่จบ)" ให้จดไว้ก่อน แล้วลงมือเมื่อ Owner สั่ง "ดำเนินการ" หรือ "แก้ไขได้เลย"
- ห้าม deploy SHA อื่นนอกจากที่ได้รับอนุมัติ ถ้ามี commit ใหม่หลังอนุมัติ ถือว่าการอนุมัตินั้นใช้ไม่ได้
- การรัน migration และการแก้ env/secret ต้องได้รับอนุมัติแยกเฉพาะเรื่อง การอนุมัติ deploy ไม่รวมอนุมัติ migration
- ห้ามกดอนุมัติ บันทึก หรือลงเวลาบน Production แทนผู้ใช้ และห้ามแก้ข้อมูลจริง
- ห้ามแสดง secret ใน log หรือรายงาน
- ห้าม merge ถ้า Owner ยังไม่สั่ง
- รอแค่ CI ผ่านก็พอ ไม่ต้องส่ง SENTINEL (ผู้รีวิวอิสระ) ตามที่ Owner สั่ง
- ทำแบบ TDD คือเขียน test ให้ fail ก่อน แล้วค่อยเขียนโค้ด
- ห้ามลบหรือลดความเข้มของ test เพื่อให้ผ่าน
- ทดสอบบนเบราว์เซอร์ที่จอ 1366×768 และ 375×812
- ห้ามใช้ `git reset --hard`, `git clean` หรือ stash งานของคนอื่น เพราะ root worktree มักมีงานค้างของงานอื่น
- ทำงานใน `.worktrees/` และห้าม force-push

---

## 8. ข้อควรรู้และหลุมพราง

- `frontend/tsconfig.tsbuildinfo` เปลี่ยนทุกครั้งที่ build ต้อง `git checkout --` ไฟล์นี้ก่อน commit
- Frontend test ต้องรันด้วย `npm test` ใน `frontend/` ถ้ารัน vitest จาก root จะเจอ exit 130
- Playwright ใช้ `--config frontend/playwright.print.config.ts` ที่ port 4179
  - worktree อื่นอาจจับ port นี้อยู่ ถ้าเป็นแบบนั้นให้ทำ config สำเนาที่เปลี่ยน port
  - ตั้ง `CI=1` เพื่อไม่ให้ใช้ server เดิมซ้ำ
- การแก้ `prisma/schema.prisma` ต้องอัปเดต schema pin ใน `scripts/ci/attendance-schema-pin.js` ใน commit เดียวกัน
  - test `attendance-schema-pin*` จะ fail ถ้าไฟล์ migration ใหม่ยังไม่ได้ commit เพราะมันอ่านจาก `git show HEAD:`
- API `/employees` จำกัด pageSize ไม่เกิน 100 ส่วน `/licenses` รับได้ถึง 1000
- รูปแบบ error ใช้ `HttpError(status, message, { code })` ส่วน frontend ใช้ `toRequestErrorState` และ `RequestErrorContent` เพื่อเก็บ request ID ไว้ (มี test บังคับ)
- การพิมพ์ใช้ `printDocument(selector, filename, { orientation, margin })` ใน `frontend/src/schedule-print.ts` ซึ่ง clone element ไปพิมพ์ใน iframe
  - element ที่พิมพ์ต้อง render เสร็จก่อน จึงใช้ `flushSync`
- อ่าน `AGENTS.md` ("SMS V3 Codex Contract") และ `MASTER_HANDOFF.md` ในรีโปก่อนเริ่มงานใหญ่

---

## 9. ทีม (ระบบ multi-agent เดิม)

- **OWNER:** ผู้ใช้ (Telegram 8992828586) เป็นผู้อนุมัติ Production เพียงคนเดียว
- **ATLAS:** PM
- **FORGE:** coding agent
- **SENTINEL:** reviewer และ release gate

Owner สั่งให้ข้ามการรีวิวโดย SENTINEL ในงานรอบนี้
