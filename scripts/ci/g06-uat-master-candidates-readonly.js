#!/usr/bin/env node
'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const departmentSites = await prisma.$queryRawUnsafe(`
    SELECT
      dm.id AS "departmentMasterId",
      dm.code AS "departmentCode",
      dm.name AS "departmentName",
      dm.is_active AS "departmentActive",
      COUNT(DISTINCT e.id)::int AS "activeEmployeeCount",
      COUNT(DISTINCT CASE WHEN ssd.is_default = TRUE THEN ssd.security_site_id END)::int AS "defaultSiteCount",
      MAX(CASE WHEN ssd.is_default = TRUE THEN s.id::text END) AS "defaultSiteId",
      MAX(CASE WHEN ssd.is_default = TRUE THEN s.code END) AS "defaultSiteCode",
      MAX(CASE WHEN ssd.is_default = TRUE THEN s.name END) AS "defaultSiteName",
      BOOL_OR(CASE WHEN ssd.is_default = TRUE THEN s.is_active ELSE FALSE END) AS "defaultSiteActive"
    FROM department_master dm
    LEFT JOIN employees e
      ON e.department = dm.name
      AND e.is_active = TRUE
      AND e.deleted_at IS NULL
    LEFT JOIN security_site_departments ssd
      ON ssd.department_master_id = dm.id
    LEFT JOIN security_sites s
      ON s.id = ssd.security_site_id
    WHERE dm.is_active = TRUE
    GROUP BY dm.id, dm.code, dm.name, dm.is_active, dm.sort_order
    ORDER BY dm.sort_order ASC, dm.name ASC
  `);

  const positions = await prisma.$queryRawUnsafe(`
    SELECT
      pm.id AS "positionMasterId",
      pm.code AS "positionCode",
      pm.name AS "positionName",
      pm.is_active AS "positionActive",
      COUNT(DISTINCT e.id)::int AS "activeEmployeeCount"
    FROM position_master pm
    LEFT JOIN employees e
      ON e.job_title = pm.name
      AND e.is_active = TRUE
      AND e.deleted_at IS NULL
    WHERE pm.is_active = TRUE
    GROUP BY pm.id, pm.code, pm.name, pm.is_active, pm.sort_order
    ORDER BY COUNT(DISTINCT e.id) DESC, pm.sort_order ASC, pm.name ASC
  `);

  const operationalCombos = await prisma.$queryRawUnsafe(`
    SELECT
      e.department AS "departmentName",
      e.job_title AS "positionName",
      COUNT(DISTINCT e.id)::int AS "activeEmployeeCount",
      COUNT(sa.id)::int AS "septemberAssignmentCount",
      MAX(s.code) FILTER (WHERE ssd.is_default = TRUE) AS "defaultSiteCode",
      MAX(s.name) FILTER (WHERE ssd.is_default = TRUE) AS "defaultSiteName"
    FROM employees e
    JOIN shift_assignments sa
      ON sa.employee_id = e.id
      AND sa.work_date >= DATE '2026-09-01'
      AND sa.work_date < DATE '2026-10-01'
    JOIN shift_types st ON st.id = sa.shift_type_id
    LEFT JOIN department_master dm ON dm.name = e.department AND dm.is_active = TRUE
    LEFT JOIN security_site_departments ssd ON ssd.department_master_id = dm.id AND ssd.is_default = TRUE
    LEFT JOIN security_sites s ON s.id = ssd.security_site_id AND s.is_active = TRUE
    WHERE e.is_active = TRUE
      AND e.deleted_at IS NULL
      AND COALESCE(st.code, '') <> 'OFF'
      AND e.department IS NOT NULL
      AND e.job_title IS NOT NULL
    GROUP BY e.department, e.job_title
    ORDER BY COUNT(sa.id) DESC, e.department ASC, e.job_title ASC
    LIMIT 30
  `);

  const cleanDepartments = departmentSites.map((row) => ({
    departmentMasterId: row.departmentMasterId,
    departmentCode: row.departmentCode,
    departmentName: row.departmentName,
    activeEmployeeCount: Number(row.activeEmployeeCount || 0),
    defaultSiteCount: Number(row.defaultSiteCount || 0),
    defaultSiteId: row.defaultSiteId,
    defaultSiteCode: row.defaultSiteCode,
    defaultSiteName: row.defaultSiteName,
    defaultSiteActive: Boolean(row.defaultSiteActive)
  }));
  const cleanPositions = positions.map((row) => ({
    positionMasterId: row.positionMasterId,
    positionCode: row.positionCode,
    positionName: row.positionName,
    activeEmployeeCount: Number(row.activeEmployeeCount || 0)
  }));
  const cleanCombos = operationalCombos.map((row) => ({
    departmentName: row.departmentName,
    positionName: row.positionName,
    activeEmployeeCount: Number(row.activeEmployeeCount || 0),
    septemberAssignmentCount: Number(row.septemberAssignmentCount || 0),
    defaultSiteCode: row.defaultSiteCode,
    defaultSiteName: row.defaultSiteName
  }));

  const recommendedCombos = cleanCombos.filter((row) => row.defaultSiteCode && row.activeEmployeeCount > 0);

  console.log('G06_UAT_MASTER_CANDIDATES_BEGIN');
  console.log(JSON.stringify({
    mode: 'READ_ONLY_G06_UAT_MASTER_CANDIDATES',
    databaseMutationPerformed: false,
    departmentsWithExactlyOneActiveDefaultSite: cleanDepartments.filter((row) => row.defaultSiteCount === 1 && row.defaultSiteActive),
    activePositionsByCurrentUsage: cleanPositions,
    septemberOperationalDepartmentPositionCombos: cleanCombos,
    recommendedExistingOperationalCombos: recommendedCombos
  }, null, 2));
  console.log('G06_UAT_MASTER_CANDIDATES_END');
})()
  .catch((error) => {
    console.error(`G06_UAT_MASTER_CANDIDATES_FAILED ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });