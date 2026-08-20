const prisma = require('../config/prisma');
const HttpError = require('../utils/http-error');
const audit = require('./audit.service');

const safeSite = (site) => ({ code: site.code, name: site.name, latitude: site.latitude, longitude: site.longitude, geofenceRadiusMeters: site.geofenceRadiusMeters, isActive: site.isActive });

function createSecuritySiteService({ prismaClient = prisma, auditService = audit } = {}) {
  async function list({ includeInactive = false } = {}) {
    return prismaClient.securitySite.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { code: 'asc' }, include: { departmentLinks: { orderBy: { departmentName: 'asc' } } } });
  }

  async function create(data, actorUserId) {
    return prismaClient.$transaction(async (tx) => {
      const existing = await tx.securitySite.findUnique({ where: { code: data.code } });
      if (existing) throw new HttpError(409, 'Security Site code already exists.', { code: 'SECURITY_SITE_CODE_CONFLICT' });
      const site = await tx.securitySite.create({ data: { ...data, departmentLinks: data.departmentNames?.length ? { create: data.departmentNames.map((departmentName) => ({ departmentName })) } : undefined }, include: { departmentLinks: true } });
      await auditService.log({ actorUserId, action: 'CREATE', entityType: 'SecuritySite', entityId: site.id, metadata: { after: safeSite(site) } }, tx);
      return site;
    });
  }

  async function update(id, data, actorUserId) {
    return prismaClient.$transaction(async (tx) => {
      const before = await tx.securitySite.findUnique({ where: { id }, include: { departmentLinks: true } });
      if (!before) throw new HttpError(404, 'Security Site not found.');
      const { departmentNames, ...siteData } = data;
      const site = await tx.securitySite.update({ where: { id }, data: { ...siteData, ...(departmentNames ? { departmentLinks: { deleteMany: {}, create: departmentNames.map((departmentName) => ({ departmentName })) } } : {}) }, include: { departmentLinks: true } });
      await auditService.log({ actorUserId, action: 'UPDATE', entityType: 'SecuritySite', entityId: id, metadata: { before: safeSite(before), after: safeSite(site) } }, tx);
      return site;
    });
  }

  return { create, list, update };
}

module.exports = { createSecuritySiteService };
