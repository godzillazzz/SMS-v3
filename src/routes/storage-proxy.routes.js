'use strict';

const express = require('express');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { createStorageReadResolver } = require('../services/storage-read-resolver');
const prisma = require('../config/prisma');
const audit = require('../services/audit.service');
const HttpError = require('../utils/http-error');

function createStorageProxyRouter({ environment = process.env, db = prisma, auditService = audit, resolver } = {}) {
  const router = express.Router();
  const readResolver = resolver || createStorageReadResolver({ environment });
  router.use(authenticate, authorize('ADMIN', 'MANAGER', 'SUPERVISOR'));
  router.get('/:kind/:id', async (req, res, next) => {
    try {
      const models = { reference: db.employeeReferencePhoto, license: db.employeeLicenseDocument, evidence: db.attendanceEvidence, selfie: db.attendanceDeviceSelfie };
      const model = models[req.params.kind];
      if (!model?.findUnique) throw new HttpError(404, 'Stored object was not found.');
      const row = await model.findUnique({
        where: { id: req.params.id },
        include: { employee: { select: { id: true, department: true } } }
      });
      if (!row || row.storageDeletedAt || row.storageDeletionRequestedAt || row.purgedAt || row.purgeRequestedAt) throw new HttpError(410, 'Stored object is no longer viewable.');
      if (req.user.role !== 'ADMIN') {
        const employee = row.employee || (row.employeeId && db.employee?.findUnique
          ? await db.employee.findUnique({ where: { id: row.employeeId }, select: { id: true, department: true } })
          : null);
        const actorDepartment = req.user.department || req.user.employeeAuthority?.department;
        const sameEmployee = req.user.employeeAuthority?.id && String(req.user.employeeAuthority.id) === String(row.employeeId);
        const inDepartment = actorDepartment && employee?.department && actorDepartment === employee.department;
        if (!employee || (!sameEmployee && !inDepartment)) throw new HttpError(403, 'Stored object is outside the actor scope.');
      }
      const result = await readResolver.read(row);
      res.set({ 'Content-Type': result.mimeType, 'Content-Length': String(result.sizeBytes), 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'", 'Cache-Control': 'private, no-store' });
      try {
        await auditService?.log?.({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'StorageObject', entityId: row.id, metadata: { event: 'PRIVATE_OBJECT_PROXY_READ', kind: req.params.kind, sizeBytes: result.sizeBytes, checksum: result.checksum } });
      } catch (error) {
        throw new HttpError(503, 'Stored object audit is temporarily unavailable.', { code: 'STORAGE_READ_AUDIT_FAILED', cause: error });
      }
      return res.end(result.bytes);
    } catch (error) { return next(error); }
  });
  return router;
}
module.exports = { createStorageProxyRouter };
