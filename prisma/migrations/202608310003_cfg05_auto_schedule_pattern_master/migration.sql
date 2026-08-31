CREATE TABLE "auto_schedule_patterns" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "mode" VARCHAR(20) NOT NULL,
  "steps" JSONB NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "target_group" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  "sort_order" INTEGER NOT NULL DEFAULT 100,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auto_schedule_patterns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auto_schedule_patterns_code_key"
  ON "auto_schedule_patterns"("code");

CREATE INDEX "auto_schedule_patterns_is_active_sort_order_idx"
  ON "auto_schedule_patterns"("is_active", "sort_order");

CREATE INDEX "auto_schedule_patterns_target_group_is_active_idx"
  ON "auto_schedule_patterns"("target_group", "is_active");

INSERT INTO "auto_schedule_patterns"
  ("code", "name", "mode", "steps", "is_active", "is_system", "target_group", "sort_order")
VALUES
  (
    'SUPERVISOR',
    'กะหัวหน้างาน',
    'WEEKLY',
    '[
      {"phaseCode":"MON","shiftCode":"D","label":"วันจันทร์ · กะเช้า"},
      {"phaseCode":"TUE","shiftCode":"D","label":"วันอังคาร · กะเช้า"},
      {"phaseCode":"WED","shiftCode":"D","label":"วันพุธ · กะเช้า"},
      {"phaseCode":"THU","shiftCode":"D","label":"วันพฤหัสบดี · กะเช้า"},
      {"phaseCode":"FRI","shiftCode":"D","label":"วันศุกร์ · กะเช้า"},
      {"phaseCode":"SAT","shiftCode":"D","label":"วันเสาร์ · กะเช้า"},
      {"phaseCode":"SUN","shiftCode":"OFF","label":"วันอาทิตย์ · วันหยุด"}
    ]'::jsonb,
    true,
    true,
    'SUPERVISOR',
    10
  ),
  (
    'ROTATE',
    'กะพนักงานเวียน',
    'CYCLE',
    '[
      {"phaseCode":"D1","shiftCode":"D","label":"กะเช้า วันที่ 1 (D1)"},
      {"phaseCode":"D2","shiftCode":"D","label":"กะเช้า วันที่ 2 (D2)"},
      {"phaseCode":"D3","shiftCode":"D","label":"กะเช้า วันที่ 3 (D3)"},
      {"phaseCode":"D4","shiftCode":"D","label":"กะเช้า วันที่ 4 (D4)"},
      {"phaseCode":"D5","shiftCode":"D","label":"กะเช้า วันที่ 5 (D5)"},
      {"phaseCode":"D6","shiftCode":"D","label":"กะเช้า วันที่ 6 (D6)"},
      {"phaseCode":"OFF-D","shiftCode":"OFF","label":"วันหยุดหลังรอบกะเช้า (OFF-D)"},
      {"phaseCode":"N1","shiftCode":"N","label":"กะดึก วันที่ 1 (N1)"},
      {"phaseCode":"N2","shiftCode":"N","label":"กะดึก วันที่ 2 (N2)"},
      {"phaseCode":"N3","shiftCode":"N","label":"กะดึก วันที่ 3 (N3)"},
      {"phaseCode":"N4","shiftCode":"N","label":"กะดึก วันที่ 4 (N4)"},
      {"phaseCode":"N5","shiftCode":"N","label":"กะดึก วันที่ 5 (N5)"},
      {"phaseCode":"N6","shiftCode":"N","label":"กะดึก วันที่ 6 (N6)"},
      {"phaseCode":"OFF-N","shiftCode":"OFF","label":"วันหยุดหลังรอบกะดึก (OFF-N)"}
    ]'::jsonb,
    true,
    true,
    'GENERAL',
    20
  );
