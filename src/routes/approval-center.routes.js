'use strict';

const express = require('express');
const { z } = require('zod');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { createApprovalCenterService } = require('../services/approval-center.service');

const router = express.Router();
const service = createApprovalCenterService();
const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(100) }).strict();
const approvalTypes = new Set([
  'EMPLOYEE_MASTER_CHANGE', 'EMPLOYEE_REFERENCE_PHOTO', 'LICENSE_DOCUMENT',
  'ATTENDANCE_DEVICE_REQUEST', 'ATTENDANCE_ADJUSTMENT_REQUEST', 'SCHEDULE_APPROVAL',
  'LEAVE_REQUEST', 'USER_ACCESS', 'REGISTRATION_REQUEST'
]);
const uuid = z.string().uuid();
const VIEW_AS_BLOCKED_DETAIL_TYPES = new Set([
  'EMPLOYEE_REFERENCE_PHOTO', 'ATTENDANCE_DEVICE_REQUEST', 'USER_ACCESS'
]);

function approvalItemNotFound() {
  const error = new Error('Approval item was not found.');
  error.statusCode = 404;
  error.publicCode = 'APPROVAL_ITEM_NOT_FOUND';
  return error;
}

function rejectViewAsNativeApprovalDetail(req, _res, next) {
  if (req.user?.impersonation && VIEW_AS_BLOCKED_DETAIL_TYPES.has(req.params.type)) return next(approvalItemNotFound());
  return next();
}

function rejectMissingNativeApprovalDetailId(req, _res, next) {
  if (VIEW_AS_BLOCKED_DETAIL_TYPES.has(req.params.type)) return next(approvalItemNotFound());
  return next();
}

async function getItem(req, res, next) {
  try {
    const params = validateItemParams(req.params);
    res.set('Cache-Control', 'no-store');
    res.json(await service.getItem({ actor: req.user, type: params.type, requestId: params.requestId, correlationId: req.requestId }));
  } catch (error) {
    next(error);
  }
}

function validateItemParams(params) {
  if (!approvalTypes.has(params.type)) {
    const error = new Error('Unsupported approval item type.');
    error.statusCode = 400;
    error.publicCode = 'APPROVAL_ITEM_TARGET_INVALID';
    throw error;
  }
  if (!uuid.safeParse(params.requestId).success) {
    // Safe native detail resolution is deliberately indistinguishable from
    // an absent queue record; malformed identifiers must not become an
    // enumeration oracle. Leave/license resolution retains its existing
    // validation contract until its separately approved remediation.
    if (['EMPLOYEE_REFERENCE_PHOTO', 'ATTENDANCE_DEVICE_REQUEST', 'USER_ACCESS'].includes(params.type)) {
      throw approvalItemNotFound();
    }
    const error = new Error('Invalid approval item request ID.');
    error.statusCode = 400;
    error.publicCode = 'APPROVAL_ITEM_TARGET_INVALID';
    throw error;
  }
  return params;
}

router.use(authenticate);
// Detail guards are exact-route middleware and precede role authorization.
router.get('/items/:type/:requestId', rejectViewAsNativeApprovalDetail, authorize('ADMIN', 'MANAGER', 'SUPERVISOR'), getItem);
router.get('/items/:type', rejectMissingNativeApprovalDetailId, authorize('ADMIN', 'MANAGER', 'SUPERVISOR'), (_req, _res, next) => next());
router.use(authorize('ADMIN', 'MANAGER', 'SUPERVISOR'));
router.get('/summary', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await service.summary({ actor: req.user, correlationId: req.requestId }));
  } catch (error) {
    next(error);
  }
});

router.get('/items/:type/:requestId', async (req, res, next) => {
  try {
    const params = validateItemParams(req.params);
    res.set('Cache-Control', 'no-store');
    res.json(await service.getItem({ actor: req.user, type: params.type, requestId: params.requestId, correlationId: req.requestId }));
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await service.list({ actor: req.user, correlationId: req.requestId, ...query.parse(req.query) }));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
