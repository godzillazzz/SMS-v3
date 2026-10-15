'use strict';

// Controlled, one-time Preview-only canonical UAT identity reconciliation.
// This script is not wired to GitHub Actions, CI, deployment or Production.
// Default mode is read-only; --apply requires explicit manual governance.
const { URL } = require('node:url');

const PREVIEW_REF = 'ezxanpfagitckpfsnflp';
const PREVIEW_CLUSTER = 'a96200459370c855ff978934689acb140b1c8573e623696cd854c76afa72fc76';
const ROLES = Object.freeze(['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER']);
const MARKER = (role) => `UAT-V3-PREVIEW-${role}`;
const EMAIL = (role) => `uat-v3-${role.toLowerCase()}@preview.invalid`;
const NAME = (role) => `UAT V3 ${role.charAt(0)}${role.slice(1).toLowerCase()}`;
const CONFIRMATION = 'RECONCILE_ONLY_PREVIEW_UAT_V3';
const LEGACY_NAMES = Object.freeze([
  'AWV1 UAT Admin', 'AWV1 UAT Manager', 'AWV1 UAT Manager 2',
  'AWV1 UAT Viewer', 'G06 Preview UAT', 'Preview UAT Admin',
  'UAT Automation Admin', 'UAT Automation Manager', 'UAT Automation Viewer'
]);

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

function targetUrlIsPreview(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host === `db.${PREVIEW_REF}.supabase.co`) return true;
    return /(^|\.)pooler\.supabase\.com$/.test(host) && url.username.endsWith(`.${PREVIEW_REF}`);
  } catch {
    return false;
  }
}

function canonicalSpecs(env) {
  const rows = ROLES.map((role) => ({
    role, displayName: NAME(role), email: EMAIL(role), legacyUserId: MARKER(role),
    suppliedEmail: env[`UAT_${role}_EMAIL`],
    password: env[`UAT_${role}_PASSWORD`]
  }));
  for (const row of rows) {
    assert(row.suppliedEmail === row.email, `UAT_V3_${row.role}_EMAIL_NOT_CANONICAL`);
    assert(typeof row.password === 'string' && row.password.length >= 16, `UAT_V3_${row.role}_PASSWORD_MISSING_OR_WEAK`);
  }
  assert(new Set(rows.map((row) => row.password)).size === 4, 'UAT_V3_PASSWORDS_NOT_DISTINCT');
  return rows;
}

function isLegacyUat(user) {
  if (!LEGACY_NAMES.includes(String(user.displayName || ''))) return false;
  if (ROLES.some((role) => user.legacyUserId === MARKER(role))) return false;
  if (String(user.displayName).startsWith('[ARCHIVED UAT]')) return false;
  return true;
}

async function verifyProvider(tx) {
  const rows = await tx.$queryRaw`
    SELECT current_database() AS database_name,
           current_user AS executing_role,
           encode(sha256(convert_to((pg_control_system()).system_identifier::text, 'UTF8')), 'hex')
             AS cluster_fingerprint
  `;
  const witness = rows[0];
  assert(witness?.database_name === 'postgres', 'UAT_V3_DATABASE_NAME_MISMATCH');
  assert(witness?.executing_role === 'postgres', 'UAT_V3_RUNTIME_ROLE_MISMATCH');
  assert(witness?.cluster_fingerprint === PREVIEW_CLUSTER, 'UAT_V3_PREVIEW_CLUSTER_MISMATCH');
}

async function reconcile({ apply = false, env = process.env, prismaClient } = {}) {
  assert(targetUrlIsPreview(env.DATABASE_URL) && targetUrlIsPreview(env.DIRECT_URL),
    'UAT_V3_PREVIEW_DATABASE_TARGET_REQUIRED');
  if (apply) assert(env.UAT_V3_RESET_CONFIRMATION === CONFIRMATION, 'UAT_V3_OWNER_CONFIRMATION_REQUIRED');

  const ownClient = !prismaClient;
  const prisma = prismaClient || new (require('@prisma/client').PrismaClient)();
  try {
    if (!apply) {
      await verifyProvider(prisma);
      const users = await prisma.user.findMany({
        where: { displayName: { in: LEGACY_NAMES } },
        select: { displayName: true, legacyUserId: true, role: true, isActive: true }
      });
      return {
        mode: 'READ_ONLY', previewVerified: true,
        legacyCandidates: users.filter(isLegacyUat).length,
        canonicalPresent: users.filter((user) => ROLES.some((role) => user.legacyUserId === MARKER(role))).length
      };
    }

    const specs = canonicalSpecs(env);
    const bcrypt = require('bcryptjs');
    const hashes = await Promise.all(specs.map((spec) => bcrypt.hash(spec.password, 12)));
    const now = new Date();

    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(746281903)`;
      await verifyProvider(tx); // Recheck inside the mutation transaction.

      const matches = await tx.user.findMany({
        where: { OR: [
          { displayName: { in: LEGACY_NAMES } },
          { email: { in: specs.map((spec) => spec.email) } },
          { legacyUserId: { in: specs.map((spec) => spec.legacyUserId) } }
        ] },
        select: {
          id: true, email: true, displayName: true, legacyUserId: true, role: true,
          isActive: true, accountStatus: true, passwordResetRequired: true, employeeId: true
        }
      });

      const canonicalExisting = new Map();
      for (const spec of specs) {
        const found = matches.filter((user) => user.email.toLowerCase() === spec.email
          || user.legacyUserId === spec.legacyUserId);
        assert(found.length <= 1, 'UAT_V3_CANONICAL_IDENTITY_COLLISION');
        if (found.length) {
          const user = found[0];
          assert(user.email.toLowerCase() === spec.email && user.legacyUserId === spec.legacyUserId,
            'UAT_V3_CANONICAL_MARKER_CONFLICT');
          assert(user.role === spec.role && user.isActive && user.accountStatus === 'ACTIVE'
            && !user.passwordResetRequired && user.employeeId === null, 'UAT_V3_CANONICAL_DRIFT');
          canonicalExisting.set(spec.role, user);
        }
      }

      let created = 0;
      for (const [index, spec] of specs.entries()) {
        if (canonicalExisting.has(spec.role)) continue; // Idempotent: never rotate credentials.
        const user = await tx.user.create({
          data: {
            email: spec.email, passwordHash: hashes[index], displayName: spec.displayName,
            legacyUserId: spec.legacyUserId, role: spec.role, department: 'UAT-PREVIEW',
            accountStatus: 'ACTIVE', isActive: true, passwordResetRequired: false,
            employeeId: null
          },
          select: { id: true }
        });
        await tx.auditLog.create({
          data: {
            actorUserId: null, action: 'CREATE', entityType: 'UATCanonicalAccount',
            entityId: user.id, metadata: { role: spec.role, previewOnly: true, canonical: true }
          }
        });
        created++;
      }

      const legacy = matches.filter(isLegacyUat);
      for (const user of legacy) {
        if (!user.isActive && user.accountStatus === 'SUSPENDED') continue;
        await tx.user.update({
          where: { id: user.id },
          data: {
            isActive: false, accountStatus: 'SUSPENDED', passwordResetRequired: true,
            tokenVersion: { increment: 1 },
            displayName: `[ARCHIVED UAT] ${user.displayName}`.slice(0, 150)
          }
        });
        await tx.auditLog.create({
          data: {
            actorUserId: null, action: 'UPDATE', entityType: 'UATLegacyArchive',
            entityId: user.id, metadata: { role: user.role, previewOnly: true, status: 'SUSPENDED' }
          }
        });
      }
      const legacyIds = legacy.map((user) => user.id);
      const revoked = legacyIds.length ? await tx.refreshSession.updateMany({
        where: { userId: { in: legacyIds }, revokedAt: null },
        data: { revokedAt: now }
      }) : { count: 0 };

      const canonical = await tx.user.findMany({
        where: { legacyUserId: { in: specs.map((spec) => spec.legacyUserId) } },
        select: { role: true, isActive: true, accountStatus: true, employeeId: true }
      });
      assert(canonical.length === 4 && new Set(canonical.map((user) => user.role)).size === 4
        && canonical.every((user) => user.isActive && user.accountStatus === 'ACTIVE' && user.employeeId === null),
      'UAT_V3_POSTCONDITION_FAILED');

      return { mode: 'APPLIED', previewVerified: true, created, archivedCandidates: legacy.length,
        revokedSessions: revoked.count, canonicalRoles: 4 };
    }, { isolationLevel: 'Serializable', timeout: 60000 });
  } finally {
    if (ownClient) await prisma.$disconnect();
  }
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  reconcile({ apply }).then((result) => {
    // Counts only. Never emit email/password/hash/database URLs.
    process.stdout.write(JSON.stringify(result) + '\n');
  }).catch(() => {
    console.error('UAT_V3_RESET_FAIL_CLOSED');
    process.exitCode = 1;
  });
}

module.exports = { reconcile, targetUrlIsPreview, canonicalSpecs, isLegacyUat, PREVIEW_REF, ROLES };
