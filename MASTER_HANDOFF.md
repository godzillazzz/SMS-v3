# MASTER HANDOFF

อัปเดต 6 ตุลาคม 2569 (เวลาไทย)

## สถานะงาน

- Integration base ที่ตรวจล่าสุด: `fix/serverless-database-reliability` @ `80cbc300e58a8eea2b3c9a128b42d56ad4e10709`.
- เฟส A: เสร็จตามขอบเขตที่ระบุด้านล่าง; ยังไม่ได้ merge PR ใด.
- เฟส B: รอ rebase ทีละ PR, CI/Preview ของ SHA หลัง rebase และ merge ตามลำดับ #470 → #471 → #472 → #473.
- เฟส C: ยังไม่เริ่ม; ลำดับคือ T05 → T01 → T02 → T03 → T06.
- ไม่ได้ deploy Production, promote, แตะ Environment approval หรือเขียนข้อมูลลงฐานข้อมูล staging/Production.

## เฟส A — สถานะ PR

| PR | SHA ก่อนแก้ / SHA หลังแก้ในเฟส A | CI / Preview ปัจจุบัน | Acceptance |
|---|---|---|---|
| #470 | `d4792405e91c3d338f1cd4fefda1b9de79f9c1c0` → `80af2825a636f35cb5a3d1d6fe67b50efc631b80` | CI run `37455507185` success; Vercel status success/Ready: https://sms-v3-staging-git-fix-schedule-approval-stat-155f07-godzillazz.vercel.app | ผ่าน: map `changeType` ครบ 12 labels ตาม backend; test ล็อกทุก label; ปุ่มยืนยันไม่อนุมัติ disabled จนเหตุผลหลัง trim ยาวอย่างน้อย 5 ตัวอักษรและมี regression test. Frontend 828/828, build และ `git diff --check` ผ่านในเครื่อง. |
| #471 | `811efc6808478edc4273bdef8940d83975a7a1b9` → `739bb43590a89dbc696e4973d07bbbf90cc9ae6c` | CI run `37456915484` success; Vercel status success/Ready: https://sms-v3-staging-git-fix-schedule-department-ro-7ffe45-godzillazz.vercel.app | ผ่านจาก CSS fixture: แถวแผนกต่างจากแถวพนักงาน, ตัวหนา, คอลัมน์ sticky ตรงกับคอลัมน์พนักงาน, ธีมสว่าง/มืดและ print; 1366×768 และ 375×812 ไม่มี page overflow. Frontend 824/824, build และ `git diff --check` ผ่าน. ทดสอบพฤติกรรมด้วย fixture เพราะไม่มี authenticated roster session; ค่า department หลายค่าอย่าง `AN1,AN2,AN3` ยังถูกมองเป็นค่าเดียวและมี regression test. |
| #472 | `06adee290b2fe2be4a359fdab2772a92d574f278` (ไม่เปลี่ยนในเฟส A) | CI run `37424402982` success; Vercel status success/Ready: https://sms-v3-staging-git-fix-schedule-auto-preview-108969-godzillazz.vercel.app | ยังไม่ได้ตรวจ acceptance ซ้ำในเฟส A. |
| #473 | `2282dda340bef35ec830a46e53be5f7bd09a3a80` (ไม่เปลี่ยนในเฟส A) | CI run `37435012347` success; Vercel status success/Ready: https://sms-v3-staging-git-fix-schedule-batch-save-10-c701ee-godzillazz.vercel.app | การทดสอบใน CI ผ่าน; ยังไม่ได้วัดเวลาจริง 1,000 รายการ. |

## T22 benchmark

เลือกข้อ (ข): งด benchmark ในรอบนี้. เกณฑ์ 15 วินาทียังรอวัดจากการใช้งานจริงบน staging. ไม่มีการเขียนหรือลบข้อมูลทดสอบในฐานข้อมูลใด.

## งานค้าง / ข้อจำกัด

- ผลข้างต้นเป็นสถานะก่อน rebase; ต้องตรวจ CI และ Preview ของ SHA หลัง rebase ใหม่ก่อน merge แต่ละ PR.
- T22: ยังไม่มีผล benchmark จริง; หากต้องการ benchmark บนฐานข้อมูลทดสอบ Preview ต้องยืนยันก่อนว่าเป็นฐานทดสอบแยกที่ทิ้งได้และอนุญาตให้ใช้ข้อมูล UAT.
