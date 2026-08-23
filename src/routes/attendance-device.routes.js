'use strict';

const express = require('express');
const { z } = require('zod');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { createAttendanceDeviceService } = require('../services/attendance-device.service');

const router = express.Router();
const service = createAttendanceDeviceService();
const uuid = z.string().uuid();
const requestInput = z.object({
  displayName: z.string().trim().min(1).max(120),
  publicKeySpkiBase64: z.string().min(16).max(8192),
  keyAlgorithm: z.literal('ECDSA_P256_SHA256').default('ECDSA_P256_SHA256'),
  platformHint: z.string().trim().max(100).nullable().optional(),
  reason: z.string().trim().max(1000).nullable().optional()
}).strict();
const proofVerify = z.object({ challengeId: z.string().uuid(), challenge: z.string().min(16).max(512), signatureBase64: z.string().min(16).max(4096) }).strict();
const reviewComment = z.object({ comment: z.string().trim().min(3).max(1000) }).strict();
const rejectInput = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();
const cancelInput = rejectInput;
const resubmitInput = z.object({ reason: z.string().trim().max(1000).nullable().optional() }).strict();
const status = z.enum(['PENDING_APPROVAL', 'RETURNED_FOR_CORRECTION', 'APPROVED', 'REJECTED', 'CANCELLED']);

router.use(authenticate);
router.get('/me', async (req, res, next) => { try { res.json({ data: await service.getMyState({ actor: req.user }) }); } catch (error) { next(error); } });
router.post('/requests', async (req, res, next) => { try { const input = requestInput.parse(req.body); res.status(201).json({ data: await service.createRequest({ actor: req.user, ...input, userAgentSnapshot: req.headers['user-agent'] || null }) }); } catch (error) { next(error); } });
router.post('/requests/:id/proof/options', async (req, res, next) => { try { res.json({ data: await service.createProofChallenge({ actor: req.user, requestId: uuid.parse(req.params.id) }) }); } catch (error) { next(error); } });
router.post('/requests/:id/proof/verify', async (req, res, next) => { try { res.json({ data: await service.verifyProof({ actor: req.user, requestId: uuid.parse(req.params.id), ...proofVerify.parse(req.body) }) }); } catch (error) { next(error); } });
router.post('/requests/:id/resubmit', async (req, res, next) => { try { res.json({ data: await service.resubmit({ actor: req.user, requestId: uuid.parse(req.params.id), ...resubmitInput.parse(req.body) }) }); } catch (error) { next(error); } });
router.post('/requests/:id/cancel', async (req, res, next) => { try { res.json({ data: await service.cancel({ actor: req.user, requestId: uuid.parse(req.params.id), ...cancelInput.parse(req.body) }) }); } catch (error) { next(error); } });

router.get('/requests', authorize('ADMIN'), async (req, res, next) => { try { res.json({ data: await service.listRequests({ actor: req.user, status: req.query.status ? status.parse(req.query.status) : 'PENDING_APPROVAL' }) }); } catch (error) { next(error); } });
router.post('/requests/:id/approve', authorize('ADMIN'), async (req, res, next) => { try { const input = z.object({ comment: z.string().trim().max(1000).nullable().optional() }).strict().parse(req.body); res.json({ data: await service.approve({ actor: req.user, requestId: uuid.parse(req.params.id), ...input }) }); } catch (error) { next(error); } });
router.post('/requests/:id/return-for-correction', authorize('ADMIN'), async (req, res, next) => { try { res.json({ data: await service.returnForCorrection({ actor: req.user, requestId: uuid.parse(req.params.id), ...reviewComment.parse(req.body) }) }); } catch (error) { next(error); } });
router.post('/requests/:id/reject', authorize('ADMIN'), async (req, res, next) => { try { res.json({ data: await service.reject({ actor: req.user, requestId: uuid.parse(req.params.id), ...rejectInput.parse(req.body) }) }); } catch (error) { next(error); } });

module.exports = router;
