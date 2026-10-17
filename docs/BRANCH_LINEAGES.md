# BRANCH LINEAGES — SMS-v3 (นโยบายสองสาย)

**สถานะ:** ประกาศใช้ 17 ตุลาคม 2569 · เจ้าของ: ATLAS (Chief PM) · อนุมัติโดย OWNER

## กฎ 3 ข้อ (บังคับ)

1. **สายแอปพลิเคชัน = `fix/serverless-database-reliability` (integration)**
   - ทุกงานที่กระทบพฤติกรรมระบบ (frontend/backend/schema/manifest) ทำบนสายนี้เท่านั้น
   - **Production ปล่อยจากสายนี้เท่านั้น** — workflow `deploy-approved-production-v2.yml` บังคับ `source_branch` ให้ตรงกับค่านี้ (บรรทัด ~90) และ Environment `production-sms-v3-staging` มี branch policy + OWNER เป็นผู้อนุมัติ

2. **สาย UAT/verification harness = `main`**
   - `e2e/uat-v3/**` (UAT V3 harness: `readonly.spec.js`, `reporter.js`, `api-diagnostics.js`, `role-matrix.js`, …) อยู่บน `main`
   - งานปรับปรุง harness (เช่น PR #646) ทำและ merge บน `main`
   - harness รันทดสอบ **แอปที่ deploy จาก integration** ผ่าน HTTP/browser (ไม่ต้องอยู่ใน branch แอป)

3. **ห้าม**
   - ❌ **ห้าม merge `main` → integration ทั้งก้อน** (จะลาก commit ที่ไม่ผ่านเกตเข้า release branch)
   - ❌ **ห้ามปล่อย Production จาก `main`** (เกตบล็อกอยู่แล้ว แต่ห้ามพยายาม)
   - ❌ ห้าม cherry-pick ข้ามสายโดยไม่มีบันทึกเหตุผล + CI บนสายปลายทาง

## วิธีทำงานปกติ

| งาน | สาย | เกต |
|---|---|---|
| ฟีเจอร์/แก้บั๊กแอป | integration | CI เขียว → SENTINEL review → manifest → OWNER อนุมัติเกต |
| UAT harness / test infra ของ UAT | main | CI เขียวบน main |
| เอกสาร/บันทึก handoff | integration | CI เขียว |

## Audit ประจำปี/ไตรมาส (กัน "fix หาย")

ทุก 3 เดือน ให้ตรวจว่า `main` มี commit ที่มีคุณค่าแต่ยังไม่ถึง Production หรือไม่:
```bash
git fetch origin
git log --oneline origin/fix/serverless-database-reliability..origin/main | head -50
git diff --name-only origin/fix/serverless-database-reliability..origin/main | head -50
```
- ถ้าพบ security fix หรือฟีเจอร์ที่ยังไม่ถึง Production → ยกเป็นงานใหม่บน integration (พร้อม CI + review)
- บันทึกผลใน `MASTER_HANDOFF.md`

## ตัวเลข ณ วันที่ประกาศ (หลักฐาน)

- integration นำ `main` = **1,537 commits** · `main` มี **294 commits** ที่ integration ไม่มี · ไฟล์ต่างกัน **1,184 ไฟล์**
- UAT V3 harness อยู่บน `main` (ยืนยันด้วย `git ls-tree origin/main:e2e/uat-v3`) · **ไม่มี**อยู่บน integration
- การรัน UAT V3 จาก `main` ไปทดสอบ Preview เคย PASS (run `38877821742`)
