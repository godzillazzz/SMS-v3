'use strict';

const prismaDefault = require('../config/prisma');
const HttpError = require('../utils/http-error');

const SITE_AUTHORITY_SOURCES = Object.freeze({
  SCHEDULE: 'SCHEDULE',
  DEPARTMENT_DEFAULT: 'DEPARTMENT_DEFAULT'
});

function http(statusCode, code, message) {
  return new HttpError(statusCode, message, { code });
}

function departmentName(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function snapshotSiteAuthority(session) {
  const site = session?.expectationSnapshot && typeof session.expectationSnapshot === 'object'
    ? session.expectationSnapshot.site
    : null;
  return {
    source: site?.authoritySource || null,
    departmentName: departmentName(site?.departmentName)
  };
}

function createSecuritySiteAuthorityService({ prisma = prismaDefault } = {}) {
  async function loadActiveSite(client, siteId, suppliedSite = null) {
    const site = suppliedSite?.id === siteId ? suppliedSite : await client.securitySite.findUnique({ where: { id: siteId } });
    if (!site) throw http(409, 'ATTENDANCE_SITE_REQUIRED', 'An authoritative Security Site is required for Attendance.');
    if (site.isActive !== true) throw http(409, 'ATTENDANCE_SITE_INACTIVE', 'The authoritative Security Site is inactive.');
    return site;
  }

  async function defaultRows(client, department) {
    return client.$queryRawUnsafe(
      `SELECT
         d.security_site_id AS "securitySiteId",
         d.department_name AS "departmentName",
         d.is_default AS "isDefault",
         s.id,
         s.code,
         s.name,
         s.latitude,
         s.longitude,
         s.geofence_radius_meters AS "geofenceRadiusMeters",
         s.is_active AS "isActive",
         s.created_at AS "createdAt",
         s.updated_at AS "updatedAt"
       FROM security_site_departments d
       JOIN security_sites s ON s.id = d.security_site_id
       WHERE d.department_name = $1 AND d.is_default = TRUE
       ORDER BY d.created_at ASC
       LIMIT 2`,
      department
    );
  }

  async function resolve({ assignment, employee = null, existingSession = null }, client = prisma) {
    if (!assignment?.id || !assignment?.employeeId) {
      throw http(409, 'ATTENDANCE_ASSIGNMENT_REQUIRED', 'An authoritative Shift Assignment is required for Attendance.');
    }

    if (assignment.securitySiteId) {
      const site = await loadActiveSite(client, assignment.securitySiteId, assignment.securitySite);
      return {
        site,
        siteId: site.id,
        source: SITE_AUTHORITY_SOURCES.SCHEDULE,
        departmentName: departmentName(assignment.departmentSnapshot || employee?.department),
        pinnedBySession: false
      };
    }

    if (existingSession?.expectedSiteId) {
      const site = await loadActiveSite(client, existingSession.expectedSiteId);
      const snapshot = snapshotSiteAuthority(existingSession);
      return {
        site,
        siteId: site.id,
        source: snapshot.source || SITE_AUTHORITY_SOURCES.DEPARTMENT_DEFAULT,
        departmentName: snapshot.departmentName || departmentName(assignment.departmentSnapshot || employee?.department),
        pinnedBySession: true
      };
    }

    let department = departmentName(assignment.departmentSnapshot) || departmentName(employee?.department);
    if (!department) {
      const currentEmployee = await client.employee.findUnique({
        where: { id: assignment.employeeId },
        select: { department: true }
      });
      department = departmentName(currentEmployee?.department);
    }
    if (!department) {
      throw http(409, 'ATTENDANCE_SITE_REQUIRED', 'The employee Department has no authoritative Default Security Site.');
    }

    const rows = await defaultRows(client, department);
    if (!rows.length) {
      throw http(409, 'ATTENDANCE_SITE_REQUIRED', 'The employee Department has no authoritative Default Security Site.');
    }
    if (rows.length > 1) {
      throw http(409, 'ATTENDANCE_SITE_AUTHORITY_CONFLICT', 'The employee Department has more than one Default Security Site.');
    }
    const row = rows[0];
    if (row.isActive !== true) {
      throw http(409, 'ATTENDANCE_SITE_INACTIVE', 'The Department Default Security Site is inactive.');
    }
    const site = {
      id: row.id,
      code: row.code,
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      geofenceRadiusMeters: row.geofenceRadiusMeters,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
    return {
      site,
      siteId: site.id,
      source: SITE_AUTHORITY_SOURCES.DEPARTMENT_DEFAULT,
      departmentName: department,
      pinnedBySession: false
    };
  }

  return { resolve };
}

module.exports = {
  SITE_AUTHORITY_SOURCES,
  departmentName,
  snapshotSiteAuthority,
  createSecuritySiteAuthorityService
};
