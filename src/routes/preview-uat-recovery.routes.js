const express = require('express');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { verifyPreviewDatabaseTarget } = require('../services/runtime-database-target-guard.service');
const { ACCOUNT_SPECS, provisionUatUsers } = require('../../scripts/admin/bootstrap-uat-users');

const RECOVERY_BRANCH = 'feature/preview-uat-runtime-recovery-v1';
const RECOVERY_CONFIRMATION = 'REPAIR_PREVIEW_UAT_ACCOUNTS';
const credentialSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256)
}).strict();
const requestSchema = z.object({
  confirmation: z.literal(RECOVERY_CONFIRMATION),
  execute: z.boolean(),
  accounts: z.object({
    ADMIN: credentialSchema,
    MANAGER: credentialSchema,
    VIEWER: credentialSchema
  }).strict()
}).strict();

function maskedResults(results) {
  return results.map((result) => ({ key: result.account.key, action: result.action }));
}

function accountConfig(body) {
  const accounts = ACCOUNT_SPECS.map((spec) => ({
    ...spec,
    email: body.accounts[spec.role].email.toLowerCase(),
    password: body.accounts[spec.role].password
  }));
  if (new Set(accounts.map((account) => account.email)).size !== accounts.length) {
    const error = new Error('UAT_RUNTIME_RECOVERY_INVALID_ACCOUNTS');
    error.code = 'UAT_RUNTIME_RECOVERY_INVALID_ACCOUNTS';
    throw error;
  }
  return { accounts, dryRun: !body.execute, requireExisting: true };
}

function createPreviewUatRecoveryRouter({
  environment = process.env,
  prismaClient = prisma,
  verifyDatabaseTarget = verifyPreviewDatabaseTarget,
  provision = provisionUatUsers
} = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (environment.VERCEL_ENV !== 'preview' || environment.VERCEL_GIT_COMMIT_REF !== RECOVERY_BRANCH) {
      return res.status(404).json({ error: 'Not found.', requestId: req.requestId });
    }
    try {
      const target = verifyDatabaseTarget(environment);
      if (!target.required || !target.matched) throw new Error('preview target not verified');
    } catch {
      return res.status(503).json({ error: 'Preview recovery unavailable.', requestId: req.requestId });
    }
    res.setHeader('Cache-Control', 'no-store');
    return next();
  });

  router.post('/', async (req, res, next) => {
    try {
      const body = requestSchema.parse(req.body || {});
      const config = accountConfig(body);
      const results = await provision({ prismaClient, config });
      return res.json({
        data: {
          mode: body.execute ? 'EXECUTE' : 'DRY_RUN',
          accounts: maskedResults(results)
        }
      });
    } catch (error) {
      if (error?.code === 'UAT_BOOTSTRAP_ACCOUNT_CONFLICT' || error?.code === 'UAT_BOOTSTRAP_ACCOUNT_MISSING') {
        return res.status(409).json({ error: 'UAT recovery account state conflict.', code: error.code, requestId: req.requestId });
      }
      if (error?.code === 'UAT_RUNTIME_RECOVERY_INVALID_ACCOUNTS') {
        return res.status(400).json({ error: 'Invalid UAT recovery account set.', code: error.code, requestId: req.requestId });
      }
      return next(error);
    }
  });

  return router;
}

module.exports = createPreviewUatRecoveryRouter();
module.exports.createPreviewUatRecoveryRouter = createPreviewUatRecoveryRouter;
module.exports.RECOVERY_BRANCH = RECOVERY_BRANCH;
module.exports.RECOVERY_CONFIRMATION = RECOVERY_CONFIRMATION;
module.exports.accountConfig = accountConfig;
module.exports.maskedResults = maskedResults;
