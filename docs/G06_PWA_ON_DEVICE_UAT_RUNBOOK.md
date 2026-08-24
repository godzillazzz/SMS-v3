# G06 Employee PWA — On-device UAT Runbook

Status: physical-device UAT pending
Scope: **ลงเวลา / ลา / โปรไฟล์ เท่านั้น**
Candidate branch: `feature/g06-attendance-context-receipt-v1`
Candidate commit before this runbook: `7c9b521ba8133f8f3d16def657157ab8e79540d6`
Exact Preview: `https://sms-v3-staging-bjnkeo0tj-godzillazz.vercel.app`

## Safety boundary

- ใช้ Preview เท่านั้น ห้ามใช้ Production สำหรับ UAT นี้
- Attendance Preview API ยังต้องเป็น HTTP 404 / hidden-by-default
- Face/Liveness/AWS runtime ยังต้องปิด
- UAT นี้ต้องไม่สร้าง `AttendanceEvent`, trusted biometric receipt หรือ biometric PASS
- QR/GPS ใช้เพื่อตรวจ mobile UX/capability เท่านั้น
- PWA ต้องมีเพียง 3 หน้า: `ลงเวลา`, `ลา`, `โปรไฟล์`

## 1. เปิด Candidate บนมือถือจริง

เปิด:

`https://sms-v3-staging-bjnkeo0tj-godzillazz.vercel.app/?pwa=1`

หาก Vercel Protection ขอ Sign in ให้ใช้บัญชีที่มีสิทธิ์เข้าถึง Preview เท่านั้น ห้ามลด/ปิด Preview protection เพื่อทำ UAT นี้

Expected:

- หน้าโหลดได้
- ไม่มี error จาก manifest/service worker
- หลัง login แล้ว PWA shell แสดงเฉพาะ 3 เมนูด้านล่าง: `ลงเวลา / ลา / โปรไฟล์`

## 2. ติดตั้ง PWA

### iPhone / Safari

1. เปิด URL Candidate ใน Safari
2. Share
3. `Add to Home Screen`
4. เปิดไอคอน `SMS` จาก Home Screen

Expected:

- เปิดแบบ standalone ไม่มี Safari address bar
- เริ่มที่ `ลงเวลา`
- safe area ด้านบน/ล่างไม่ทับ header หรือ bottom navigation

### Android / Chrome

1. เปิด URL Candidate ใน Chrome
2. Menu
3. `Install app` หรือ `Add to Home screen`
4. เปิดไอคอน `SMS`

Expected เหมือน iPhone

## 3. โปรไฟล์ — Device/PWA Diagnostics

เข้า `โปรไฟล์` → `ความพร้อม PWA บนอุปกรณ์`

Expected หลัก:

- โหมดแอป: `ติดตั้ง / Standalone`
- Secure context: `พร้อม`
- กล้อง: `รองรับ`
- Location: `รองรับ`
- Service Worker: รองรับ และควรเป็น `ควบคุม PWA แล้ว`

หมายเหตุ: ถ้า Service Worker แสดง `รองรับ · รอควบคุม/รีโหลด` ในการเปิดครั้งแรก ให้ปิด PWA แล้วเปิดใหม่ 1 ครั้งก่อนตัดสินผล

กด `คัดลอกรายงาน UAT`

Expected report format:

```text
SMS_PWA_UAT_V1
online=true
standalone=true
secureContext=true
serviceWorkerSupported=true
serviceWorkerControlled=true
cameraSupported=true
locationSupported=true
```

รายงานต้อง **ไม่มี** ชื่อ, อีเมล, User-Agent, QR, พิกัด GPS, biometric data หรือ receipt

## 4. ลงเวลา — QR Camera

1. เข้า `ลงเวลา`
2. กด `สแกน QR`
3. อนุญาต Camera เฉพาะเมื่อ browser ขอ permission
4. สแกน QR ที่ไม่ใช่ข้อมูลจริง/ข้อมูลลับ และมีข้อความยาวอย่างน้อย 24 ตัวอักษร
5. ใช้ QR ของ URL Preview บนอีกจอหนึ่งเป็น test fixture ได้

Expected:

- กล้องหลังเปิดได้
- QR decode สำเร็จ
- หลังอ่าน QR สำเร็จ dialog ปิด
- Camera media track/indicator ต้องหยุดหลัง decode/close
- ไม่มีภาพ/video frame ถูกอัปโหลดหรือเก็บถาวร

**STOP/FAIL** ถ้า camera indicator ยังค้างหลังปิด scanner หรือเปลี่ยนหน้า

## 5. ลงเวลา — One-shot Location

1. กด `อ่านตำแหน่งปัจจุบัน`
2. อนุญาต Location เฉพาะเมื่อ browser ขอ permission

Expected:

- ใช้ตำแหน่งครั้งเดียว
- แสดงค่าความแม่นยำและเวลาที่อ่าน
- ไม่มี continuous tracking
- ไม่มี background location indicator ต่อเนื่องหลังจบการอ่าน

จากนั้นเมื่อ QR + GPS พร้อม ให้กด `ตรวจสอบความพร้อม`

Expected ใน Candidate ปัจจุบัน:

- แสดงว่า **ระบบลงเวลายังไม่เปิดใช้งานในสภาพแวดล้อมนี้**
- Attendance API ยังคง hidden-by-default
- ต้องไม่มีข้อความ `ลงเวลาสำเร็จ`
- ต้องไม่มี Face/Liveness start
- ต้องไม่มี AttendanceEvent ถูกสร้าง

## 6. Offline behavior

หลังเปิด PWA และโหลด shell แล้ว:

1. เปิด Airplane Mode / ตัด network
2. กลับเข้า PWA

Expected:

- มีสถานะ `ออฟไลน์`
- หน้า shell ยังเปิดดูได้ถ้ามี cache
- `ลงเวลา`: scanner / QR input / GPS / readiness ถูกปิดก่อนส่ง request
- `ลา`: action ที่ mutate ถูก disable; ต้องส่งคำขอลาไม่ได้
- ห้ามมี synthetic success หรือ `OFFLINE_PENDING` ใน V1 นี้

เปิด network กลับ แล้ว Expected: online state กลับมาโดยไม่ต้อง reinstall PWA

## 7. ลา — Self-service only

เข้า `ลา`

Expected:

- เห็นข้อมูล/คำขอลาของตนเอง
- ไม่มีการเลือกพนักงานคนอื่นเพื่อยื่นลาแทนใน PWA
- ไม่มี approval/reject/return controls ของ Manager/Admin ใน PWA
- Web ปกติยังคง authority เดิม; ข้อนี้เป็นข้อจำกัดเฉพาะ PWA shell

## 8. โปรไฟล์

Expected:

- แสดงบัญชี/Role/หน่วยงาน/online state
- มีทางเข้า Passkey security
- มี Logout
- ไม่มีหน้า Attendance Device enrollment ใน PWA navigation
- Profile diagnostics ต้องไม่ขอ Camera/Location permission เอง

## 9. Stop conditions

หยุด UAT และถือว่า FAIL ทันทีหากพบข้อใดข้อหนึ่ง:

- PWA มีเมนูอื่นนอกเหนือจาก `ลงเวลา / ลา / โปรไฟล์`
- Attendance route ใช้งานได้แทนที่จะเป็น hidden/404 ใน Candidate นี้
- หน้าเว็บแสดง `ลงเวลาสำเร็จ`
- Face/Liveness เริ่มทำงาน
- Camera ไม่หยุดหลังอ่าน QR/ปิด scanner
- Location ทำงานต่อเนื่องหรือ background
- Offline แล้วสามารถส่ง Attendance/Leave mutation สำเร็จ
- Profile diagnostics ขอ permission กล้อง/GPS เอง
- UAT report มีข้อมูลระบุตัวตน/QR/พิกัด/biometric/receipt
- Production ถูก deploy/migrate/reconfigure ระหว่าง UAT นี้

## 10. Evidence ที่ส่งกลับหลังทดสอบมือถือจริง

ส่งกลับอย่างน้อย:

1. ข้อความจากปุ่ม `คัดลอกรายงาน UAT`
2. รุ่นอุปกรณ์ + OS แบบทั่วไป เช่น `iPhone / iOS 19` หรือ `Android / Chrome` (ไม่ต้องส่ง device identifier)
3. PASS/FAIL ของ:
   - Install/Standalone
   - Safe area / bottom nav
   - QR camera + track release
   - One-shot GPS
   - Offline blocking
   - Leave self-service
   - Profile diagnostics/report
4. Screenshot เฉพาะหน้าที่มีปัญหา หากมี โดยหลีกเลี่ยงข้อมูลส่วนบุคคล

Physical-device UAT จะถือว่า COMPLETE ต่อเมื่อหลักฐานชุดนี้ถูก review และไม่มี stop condition ค้างอยู่
