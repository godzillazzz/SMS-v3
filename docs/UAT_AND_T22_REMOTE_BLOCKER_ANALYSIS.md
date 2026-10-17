# UAT 4 roles + T22 remote E2E — วิเคราะห์ตัวบล็อก (17 ต.ค. 2569)

**สรุป:** ทั้งสองงาน **ติดตัวบล็อกเดียวกัน** คือ **ยังไม่มี Preview + ฐานข้อมูลแยกที่อนุมัติ (F004)** — ไม่ใช่เรื่อง "ขาด credential" อย่างเดียว และ **ทดสอบบน Production ไม่ได้ตามนโยบาย**

## 1. Authenticated UAT 4 roles — ทำไมรันตอนนี้ไม่ได้

harness ตัวจริงอยู่บนสาย `main`: `e2e/uat-v3/` (`config.js`, `readonly.spec.js`, `role-matrix.js`, `security.js`, `database-isolation.js`) พร้อม workflow `authenticated-uat-v3-readonly.yml`

`config.js` **ปฏิเสธ** (fail-closed) เว้นแต่จะครบทุกข้อ:

| เงื่อนไข | รายละเอียด |
|---|---|
| ปลายทางต้องเป็น **Preview ที่ทิ้งได้** | host ต้องเข้าฮูป `sms-v3-staging-<random>-godzillazz.vercel.app` · **ห้ามใช้ canonical host** (`UAT_IMMUTABLE_PREVIEW_REQUIRED` / `UAT_PREVIEW_URL_INVALID`) |
| credential ครบ 4 บทบาท | `UAT_<ROLE>_EMAIL` + `UAT_<ROLE>_PASSWORD` · ทั้ง 4 ต้องเป็นบัญชีต่างกัน (`UAT_ROLE_ACCOUNTS_NOT_DISTINCT`) |
| target manifest ต้องอนุมัติแล้ว | `authorized: true` · `database_isolation_verified: true` (`UAT_DISPOSABLE_TARGET_NOT_AUTHORIZED`) |
| หลักฐาน isolation | URL ของ GitHub Actions run + fingerprint 64 hex (`UAT_DB_ISOLATION_EVIDENCE_REQUIRED`) |
| DB ต้องแยกจาก Production จริง | fingerprint ของ preview ต้อง **ไม่เท่า** production + cluster fingerprint ต่างกัน + principal แยก (`UAT_DATABASE_NOT_DISTINCT_FROM_PRODUCTION`, `UAT_PROVIDER_CLUSTER_WITNESS_REQUIRED`) |
| runtime guard ต้องตรงซอร์ส | sha256 ของ `src/app.js`, `src/config/prisma.js`, `runtime-database-target-guard.service.js`, `database-target-identity` (`UAT_RUNTIME_GUARD_SOURCE_REQUIRED`) |

⇒ **ตรงกับ F004 ที่ยัง BLOCKED**: ไม่มี Preview DB ที่อนุมัติ ⇒ ไม่มี manifest ที่ผ่าน ⇒ harness ไม่ยอมรัน
⇒ และถึงมี credential ก็ **รันกับ Production ไม่ได้** เพราะ host ถูกปฏิเสธและ DB ต้องแยกจาก Production

## 2. T22 remote E2E — ทำไมยังเปิดอยู่

- ต้องเขียน **1,000 กะ** ลงฐานข้อมูลจริงของปลายทาง ⇒ ต้องเป็น **DB ที่แยกและลบได้** (เช่นเดียวกับ F004)
- บน Production/shared DB **ห้ามเขียน** ตามคำสั่งที่บันทึกไว้ (ห้ามเขียน 1,000 แถวลง DB ที่ใช้ร่วมกัน)
- สิ่งที่ทำได้แล้วและปิดได้: **CI benchmark** (Postgres container) = 3×1,000 กะ · p50 **443.668 ms** · p95 514.997 ms · max 522.922 ms · เกณฑ์ 15,000 ms = **PASS** · run `39042384522` · cleanup ครบ

## 3. ทางเลือกที่ต้องให้ OWNER ตัดสิน (เลือกได้มากกว่า 1)

| # | ทางเลือก | ผล | ต้องมีอะไร |
|---|---|---|---|
| A | **ปิด T22 ด้วยหลักฐาน CI** (ยอมรับว่าเป็น capability benchmark ไม่ใช่ Production latency) | ปิด T22 ได้ทันที ไม่ต้องรอ infra | OWNER ลงนามรับทราบ caveat 1 บรรทัด |
| B | **สร้าง Preview + DB แยก** เพื่อทำ UAT 4 roles + T22 remote ให้ครบ | ปลดทั้ง F004, UAT, T22 remote พร้อมกัน | OWNER อนุมัติสร้าง Preview DB (แยกจาก Production) + อนุมัติ manifest + บัญชีเดิม 4 บทบาท |
| C | **ปล่อยเป็น BLOCKED ต่อไป** | ไม่มีความเสี่ยง/ไม่ใช้งบ แต่ F004/UAT/T22 remote ค้างถาวร | — |

## 4. สิ่งที่ ATLAS ต้องการจาก OWNER (สั้น ๆ)

1. **T22:** เลือก A (ปิดด้วย CI benchmark) หรือ B (รอ Preview DB)
2. **UAT 4 roles:** เลือก B หรือ C
3. ถ้าเลือก B: อนุญาตให้สร้าง **Preview environment + ฐานข้อมูลแยก** (ไม่ใช่ Production) และใช้บัญชีเดิม 4 บทบาท — ATLAS จะจัดทำ target manifest + หลักฐาน isolation + รัน harness แล้วรายงานผลแบบ sanitized

**หมายเหตุความปลอดภัย:** เอกสารนี้ไม่บันทึก credential ใด ๆ · ไม่มีการรัน UAT/T22 remote ในรอบนี้ · ไม่มีการแตะ Production
