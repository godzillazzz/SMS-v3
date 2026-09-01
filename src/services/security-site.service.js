'use strict';

const crypto = require('node:crypto');
const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');
const { haversineMeters } = require('./attendance-site-evidence.service');

function http(statusCode, code, message) {
  return new HttpError(statusCode, message, { code });
}

function normalizeReason(value, code = 'SECURITY_SITE_REASON_REQUIRED') {
  const reason = String(value || '').trim();
  if (reason.length < 3) throw http(400, code, 'Reason must be at least 3 characters.');
  if (reason.length > 1000) throw http(400, 'SECURITY_SITE_REASON_INVALID', 'Reason is too long.');
  return reason;
}

function normalizeDepartmentName(value) {
  const normalized = String(value || '').trim();
  if (!normalized) throw http(400, 'DEPARTMENT_REQUIRED', 'Department name is required.');
  if (normalized.length > 100) throw http(400, 'DEPARTMENT_INVALID', 'Department name is too long.');
  return normalized;
}

function safeQr(row) {
  return row ? {
    id: row.id,
    securitySiteId: row.securitySiteId,
    version: row.version,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt
  } : null;
}

function mappingRow(row) {
  return {
    securitySiteId: row.securitySiteId,
    departmentMasterId: row.departmentMasterId || null,
    departmentCode: row.departmentCode || null,
    departmentName: row.departmentName,
    departmentNameSnapshot: row.departmentNameSnapshot || row.departmentName,
    isDefault: row.isDefault === true
  };
}

function siteSafe(row, departmentLinks = []) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    latitude: row.latitude == null ? null : String(row.latitude),
    longitude: row.longitude == null ? null : String(row.longitude),
    geofenceRadiusMeters: row.geofenceRadiusMeters,
    isActive: row.isActive === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    departmentLinks,
    currentQrCredential: safeQr((row.qrCredentials || []).find((credential) => !credential.revokedAt) || null),
    qrCredentials: (row.qrCredentials || []).map(safeQr)
  };
}

function overlapWarnings(sites) {
  const active = sites.filter((site) => site.isActive === true);
  const warnings = [];
  for (let left = 0; left < active.length; left += 1) {
    for (let right = left + 1; right < active.length; right += 1) {
      const a = active[left];
      const b = active[right];
      const distanceMeters = haversineMeters(Number(a.latitude), Number(a.longitude), Number(b.latitude), Number(b.longitude));
      const combinedRadiusMeters = Number(a.geofenceRadiusMeters) + Number(b.geofenceRadiusMeters);
      if (distanceMeters < combinedRadiusMeters) {
        warnings.push({
          siteId: a.id,
          otherSiteId: b.id,
          siteCode: a.code,
          otherSiteCode: b.code,
          distanceMeters: Number(distanceMeters.toFixed(2)),
          combinedRadiusMeters,
          overlapMeters: Number((combinedRadiusMeters - distanceMeters).toFixed(2))
        });
      }
    }
  }
  return warnings;
}

function createSecuritySiteService({
  prisma = prismaDefault,
  audit = auditDefault,
  randomBytes = crypto.randomBytes
} = {}) {
  async function readMappings(client, departmentMasterId = null) {
    const sql = `SELECT ssd.security_site_id AS "securitySiteId", ssd.department_master_id AS "departmentMasterId", dm.code AS "departmentCode", dm.name AS "departmentName", ssd.department_name AS "departmentNameSnapshot", ssd.is_default AS "isDefault" FROM security_site_departments ssd JOIN department_master dm ON dm.id = ssd.department_master_id${departmentMasterId ? ' WHERE ssd.department_master_id = $1::uuid' : ''} ORDER BY dm.sort_order ASC, dm.name ASC, ssd.is_default DESC, ssd.security_site_id ASC`;
    return departmentMasterId ? client.$queryRawUnsafe(sql, departmentMasterId) : client.$queryRawUnsafe(sql);
  }

  async function list({ includeInactive = true } = {}) {
    const [sites, mappings] = await Promise.all([
      prisma.securitySite.findMany({
        where: includeInactive ? undefined : { isActive: true },
        include: { qrCredentials: { orderBy: { version: 'desc' } } },
        orderBy: [{ isActive: 'desc' }, { code: 'asc' }]
      }),
      readMappings(prisma)
    ]);
    const linksBySite = new Map();
    for (const row of mappings) {
      const rows = linksBySite.get(row.securitySiteId) || [];
      rows.push(mappingRow(row));
      linksBySite.set(row.securitySiteId, rows);
    }
    const data = sites.map((row) => siteSafe(row, linksBySite.get(row.id) || []));
    return { sites: data, overlapWarnings: overlapWarnings(data) };
  }

  async function listDepartments() {
    const [masters, mappings] = await Promise.all([
      prisma.departmentMaster.findMany({ orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }] }),
      readMappings(prisma)
    ]);
    const byDepartment = new Map();
    for (const row of mappings) {
      const listForDepartment = byDepartment.get(String(row.departmentMasterId)) || [];
      listForDepartment.push(mappingRow(row));
      byDepartment.set(String(row.departmentMasterId), listForDepartment);
    }
    return masters.map((master) => {
      const links = byDepartment.get(String(master.id)) || [];
      return {
        departmentMasterId: master.id,
        departmentCode: master.code,
        departmentName: master.name,
        isActive: master.isActive,
        siteIds: links.map((row) => row.securitySiteId),
        defaultSiteId: links.find((row) => row.isDefault)?.securitySiteId || null,
        links
      };
    });
  }

  async function create(data, actorUserId) {
    return prisma.$transaction(async (tx) => {
      let created;
      try {
        created = await tx.securitySite.create({
          data: {
            code: String(data.code || '').trim().toUpperCase(),
            name: String(data.name || '').trim(),
            latitude: data.latitude,
            longitude: data.longitude,
            geofenceRadiusMeters: data.geofenceRadiusMeters,
            isActive: data.isActive !== false
          }
        });
      } catch (error) {
        if (error?.code === 'P2002') throw http(409, 'SECURITY_SITE_CODE_CONFLICT', 'Security Site code already exists.');
        throw error;
      }
      await audit.log({ actorUserId, action: 'CREATE', entityType: 'SecuritySite', entityId: created.id, metadata: { after: siteSafe(created) } }, tx);
      return siteSafe(created);
    });
  }

  async function duplicate(id, data, actorUserId) {
    return prisma.$transaction(async (tx) => {
      const source = await tx.securitySite.findUnique({ where: { id } });
      if (!source) throw http(404, 'SECURITY_SITE_NOT_FOUND', 'Security Site not found.');
      let created;
      try {
        created = await tx.securitySite.create({ data: { code: String(data.code || '').trim().toUpperCase(), name: String(data.name || (source.name + ' Copy')).trim(), latitude: source.latitude, longitude: source.longitude, geofenceRadiusMeters: source.geofenceRadiusMeters, isActive: false } });
      } catch (error) {
        if (error?.code === 'P2002') throw http(409, 'SECURITY_SITE_CODE_CONFLICT', 'Security Site code already exists.');
        throw error;
      }
      await audit.log({ actorUserId, action: 'CREATE', entityType: 'SecuritySite', entityId: created.id, metadata: { action: 'DUPLICATE', sourceSecuritySiteId: id, after: siteSafe(created) } }, tx);
      return siteSafe(created);
    });
  }

  async function update(id, data, actorUserId) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.securitySite.findUnique({ where: { id } });
      if (!before) throw http(404, 'SECURITY_SITE_NOT_FOUND', 'Security Site not found.');
      if (data.isActive === false && before.isActive === true) {
        const defaults = await tx.$queryRawUnsafe(
          `SELECT department_name AS "departmentName" FROM security_site_departments WHERE security_site_id = $1::uuid AND is_default = TRUE LIMIT 1`,
          id
        );
        if (defaults.length) throw http(409, 'SECURITY_SITE_DEFAULT_IN_USE', 'Remove this Site as Department Default before deactivation.');

        const openAttendanceSession = await tx.attendanceSession.findFirst({
          where: { expectedSiteId: id, state: 'OPEN', closedAt: null },
          select: { id: true }
        });
        if (openAttendanceSession) {
          throw http(409, 'SECURITY_SITE_OPEN_ATTENDANCE_IN_USE', 'Close the open Attendance session before deactivating this Security Site.');
        }
      }
      let updated;
      try {
        updated = await tx.securitySite.update({
          where: { id },
          data: {
            ...(data.code !== undefined ? { code: String(data.code).trim().toUpperCase() } : {}),
            ...(data.name !== undefined ? { name: String(data.name).trim() } : {}),
            ...(data.latitude !== undefined ? { latitude: data.latitude } : {}),
            ...(data.longitude !== undefined ? { longitude: data.longitude } : {}),
            ...(data.geofenceRadiusMeters !== undefined ? { geofenceRadiusMeters: data.geofenceRadiusMeters } : {}),
            ...(data.isActive !== undefined ? { isActive: data.isActive } : {})
          }
        });
      } catch (error) {
        if (error?.code === 'P2002') throw http(409, 'SECURITY_SITE_CODE_CONFLICT', 'Security Site code already exists.');
        throw error;
      }
      if (data.isActive === false) {
        await tx.$executeRawUnsafe(`DELETE FROM security_site_departments WHERE security_site_id = $1::uuid`, id);
      }
      await audit.log({ actorUserId, action: 'UPDATE', entityType: 'SecuritySite', entityId: id, metadata: { before: siteSafe(before), after: siteSafe(updated) } }, tx);
      return siteSafe(updated);
    });
  }

  async function replaceDepartmentMapping({ departmentMasterId, siteIds = [], defaultSiteId = null }, actorUserId) {
    const uniqueSiteIds = [...new Set(siteIds.map(String))];
    if (defaultSiteId && !uniqueSiteIds.includes(String(defaultSiteId))) throw http(400, 'SECURITY_SITE_DEFAULT_NOT_ALLOWED', 'Default Site must also be selected as an allowed Site for the Department.');
    return prisma.$transaction(async (tx) => {
      const master = await tx.departmentMaster.findUnique({ where: { id: departmentMasterId } });
      if (!master || !master.isActive) throw http(409, 'DEPARTMENT_MASTER_ACTIVE_REQUIRED', 'Department mapping requires an Active Department Master.');
      const existing = await readMappings(tx, departmentMasterId);
      const sites = uniqueSiteIds.length ? await tx.securitySite.findMany({ where: { id: { in: uniqueSiteIds } } }) : [];
      if (sites.length !== uniqueSiteIds.length) throw http(400, 'SECURITY_SITE_MAPPING_INVALID', 'One or more Security Sites do not exist.');
      if (sites.some((site) => site.isActive !== true)) throw http(409, 'SECURITY_SITE_MAPPING_INACTIVE', 'Inactive Security Sites cannot be assigned to a Department.');
      await tx.$executeRawUnsafe(`DELETE FROM security_site_departments WHERE department_master_id = $1::uuid`, departmentMasterId);
      for (const siteId of uniqueSiteIds) {
        await tx.$executeRawUnsafe(`INSERT INTO security_site_departments (id, security_site_id, department_master_id, department_name, is_default, created_at, updated_at) VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, NOW(), NOW())`, siteId, departmentMasterId, master.name, String(siteId) === String(defaultSiteId || ''));
      }
      const after = await readMappings(tx, departmentMasterId);
      await audit.log({ actorUserId, action: 'UPDATE', entityType: 'SecuritySiteDepartment', entityId: departmentMasterId, metadata: { departmentMasterId, departmentCode: master.code, departmentName: master.name, before: existing.map(mappingRow), after: after.map(mappingRow) } }, tx);
      return { departmentMasterId, departmentCode: master.code, departmentName: master.name, isActive: master.isActive, siteIds: after.map((row) => row.securitySiteId), defaultSiteId: after.find((row) => row.isDefault)?.securitySiteId || null, links: after.map(mappingRow) };
    });
  }

  async function rotateQr(siteId, actorUserId, rawReason) {
    const reason = normalizeReason(rawReason, 'SECURITY_SITE_QR_ROTATE_REASON_REQUIRED');
    const rawToken = randomBytes(32).toString('base64url');
    const hash = crypto.createHash('sha256').update(Buffer.from(rawToken, 'utf8')).digest('hex');
    return prisma.$transaction(async (tx) => {
      const site = await tx.securitySite.findUnique({ where: { id: siteId } });
      if (!site) throw http(404, 'SECURITY_SITE_NOT_FOUND', 'Security Site not found.');
      if (!site.isActive) throw http(409, 'SECURITY_SITE_INACTIVE', 'Inactive Security Sites cannot issue Attendance QR credentials.');
      const latest = await tx.securitySiteQrCredential.findFirst({ where: { securitySiteId: siteId }, orderBy: { version: 'desc' } });
      const now = new Date();
      await tx.securitySiteQrCredential.updateMany({ where: { securitySiteId: siteId, revokedAt: null }, data: { revokedAt: now } });
      const credential = await tx.securitySiteQrCredential.create({
        data: { securitySiteId: siteId, tokenHash: hash, version: (latest?.version || 0) + 1, validFrom: now }
      });
      await audit.log({
        actorUserId,
        action: 'UPDATE',
        entityType: 'SecuritySiteQrCredential',
        entityId: credential.id,
        metadata: { securitySiteId: siteId, version: credential.version, action: 'ROTATE', reason }
      }, tx);
      return { credential: safeQr(credential), qrToken: rawToken };
    });
  }

  async function revokeQr(siteId, credentialId, actorUserId, rawReason) {
    const reason = normalizeReason(rawReason, 'SECURITY_SITE_QR_REVOKE_REASON_REQUIRED');
    return prisma.$transaction(async (tx) => {
      const credential = await tx.securitySiteQrCredential.findUnique({ where: { id: credentialId } });
      if (!credential || credential.securitySiteId !== siteId) throw http(404, 'SECURITY_SITE_QR_NOT_FOUND', 'Security Site QR credential not found.');
      const revoked = credential.revokedAt
        ? credential
        : await tx.securitySiteQrCredential.update({ where: { id: credentialId }, data: { revokedAt: new Date() } });
      await audit.log({
        actorUserId,
        action: 'UPDATE',
        entityType: 'SecuritySiteQrCredential',
        entityId: credentialId,
        metadata: { securitySiteId: siteId, version: credential.version, action: 'REVOKE', reason }
      }, tx);
      return safeQr(revoked);
    });
  }

  return { list, listDepartments, create, duplicate, update, replaceDepartmentMapping, rotateQr, revokeQr };
}

module.exports = {
  normalizeReason,
  normalizeDepartmentName,
  overlapWarnings,
  createSecuritySiteService
};