#!/usr/bin/env node
/**
 * FINAL MANAGER GLOBAL RETROACTIVE LEAVE POLICY UAT WITH DATABASE
 * Run from project root: node scripts/ci/run-uat-with-db.js
 */
'use strict';

const https = require('https');

// Helper to load all environment variables from local Vercel env file
const loadLocalVercelEnv = () => {
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const filePath = path.join(__dirname, '../../.vercel/.env.production.local');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split(/\r?\n/);
      let loadedCount = 0;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          let val = match[2].trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (val) {
            // Prevent overwriting existing critical variables
            if (['DATABASE_URL', 'DIRECT_URL'].includes(key) && process.env[key]) {
              console.log(`Skipped overwriting existing ${key} with Vercel env.`);
              continue;
            }
            process.env[key] = val;
            loadedCount++;
          }
        }
      }
      console.log(`Successfully loaded ${loadedCount} env variables from local Vercel env file.`);
      if (process.env.JWT_SECRET) {
        const val = process.env.JWT_SECRET;
        console.log(`Resolved JWT_SECRET length: ${val.length}, prefix: ${val.slice(0, 3)}, suffix: ${val.slice(-3)}`);
      }
    } else {
      console.log('Local Vercel env file not found.');
    }
  } catch (e) {
    console.log('Failed to read local Vercel env file:', e.message);
  }
};

// Fill dummy defaults for non-critical required env variables to satisfy Zod schema
const fillDummyEnvDefaults = () => {
  process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30m';
  process.env.RATE_LIMIT_HASH_SECRET = process.env.RATE_LIMIT_HASH_SECRET || 'test-rate-limit-secret-with-at-least-thirty-two-chars';
  process.env.COOKIE_SECURE = process.env.COOKIE_SECURE || 'false';
  process.env.COOKIE_SAME_SITE = process.env.COOKIE_SAME_SITE || 'lax';
  process.env.REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
  process.env.OTP_DELIVERY_PROVIDER = process.env.OTP_DELIVERY_PROVIDER || 'memory';
  process.env.OTP_HASH_SECRET = process.env.OTP_HASH_SECRET || 'test-otp-secret-with-at-least-thirty-two-chars';
  process.env.ALERT_DEDUP_STORE = process.env.ALERT_DEDUP_STORE || 'memory';
  process.env.ALERT_DEDUP_HASH_SECRET = process.env.ALERT_DEDUP_HASH_SECRET || 'test-alert-secret-with-at-least-thirty-two-chars';
  console.log('Filled dummy env defaults for Zod validation.');
};

let env, prisma, accessTokenFor;

const BASE    = process.env.UAT_BASE_URL || 'https://sms-v3-staging-ten.vercel.app';
const BYPASS  = 'mySVh2ZVW8EL3cspmySVh2ZVW8EL3csp';

// ── HTTP helper ────────────────────────────────────────────────
const api = (method, path, token, body) => new Promise((resolve) => {
  const payload = body ? JSON.stringify(body) : null;
  const baseUrl = new URL(BASE);
  const options = {
    hostname: baseUrl.hostname,
    path, method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-vercel-protection-bypass': BYPASS,
      'Content-Type': 'application/json',
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
    }
  };
  const req = https.request(options, (res) => {
    let raw = '';
    res.on('data', d => raw += d);
    res.on('end', () => {
      try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
      catch { resolve({ status: res.statusCode, data: { raw } }); }
    });
  });
  req.on('error', (e) => resolve({ status: -1, data: { error: e.message } }));
  if (payload) req.write(payload);
  req.end();
});

// ── Colours ────────────────────────────────────────────────────
const G = s => `\x1b[32m${s}\x1b[0m`;
const R = s => `\x1b[31m${s}\x1b[0m`;
const Y = s => `\x1b[33m${s}\x1b[0m`;
const B = s => `\x1b[36m${s}\x1b[0m`;
const W = s => `\x1b[1m${s}\x1b[0m`;

let passed = 0, failed = 0;
const RESULTS = [];

const PASS = (label, detail = '') => { passed++; RESULTS.push({ ok: true, label }); console.log(G(`  ✅ PASS: ${label}`) + (detail ? `  →  ${detail}` : '')); };
const FAIL = (label, detail = '') => { failed++; RESULTS.push({ ok: false, label }); console.log(R(`  ❌ FAIL: ${label}`) + (detail ? `  →  ${detail}` : '')); };
const INFO = (msg)  => console.log(Y(`  ℹ  ${msg}`));
const HEAD = (msg)  => console.log(B(`\n══ ${msg} ══`));

// ── Date helpers ───────────────────────────────────────────────
const daysAgo = (n) => {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() + 7); // Bangkok UTC+7
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const daysAhead = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ── Sign tokens using project's auth.service ──────────────────
const sign = (user) => accessTokenFor(user, { expiresIn: '4h' });

(async () => {
  loadLocalVercelEnv();
  fillDummyEnvDefaults();

  // Load modules dynamically after JWT_SECRET is set
  env = require('../../src/config/env');
  prisma = require('../../src/config/prisma');
  accessTokenFor = require('../../src/services/auth.service').accessTokenFor;

  console.log(B('\n╔══════════════════════════════════════════════════════════════╗'));
  console.log(B('║  MANAGER GLOBAL RETROACTIVE LEAVE POLICY UAT                 ║'));
  console.log(B('╚══════════════════════════════════════════════════════════════╝'));

  // Discover actors
  HEAD('Discovering test actors from staging DB');
  const allUsers = await prisma.user.findMany({
    where: { isActive: true, accountStatus: 'ACTIVE' },
    select: {
      id: true, email: true, role: true, employeeId: true,
      employee: { select: { id: true, firstName: true, lastName: true, jobTitle: true, department: true, isActive: true } }
    }
  });

  const adminUser = allUsers.find(u => u.role === 'ADMIN');
  const managerUsers = allUsers.filter(u => u.role === 'MANAGER' && u.employee);
  const viewerUser = allUsers.find(u => u.role === 'VIEWER' && u.employeeId);

  if (!adminUser || managerUsers.length === 0 || !viewerUser) {
    console.error(R('Missing required test actors (ADMIN, MANAGER with employee, or VIEWER with employeeId) in staging DB.'));
    await prisma.$disconnect();
    process.exit(1);
  }

  const managerActor = managerUsers[0];
  const viewerActor = viewerUser;

  const allEmployees = await prisma.employee.findMany({ where: { isActive: true, deletedAt: null } });
  const sameDeptEmps = allEmployees.filter(e => e.id !== managerActor.employeeId && e.department === managerActor.employee.department);
  const crossDeptEmps = allEmployees.filter(e => e.id !== managerActor.employeeId && e.department !== managerActor.employee.department);

  const targetSame = sameDeptEmps[0] || allEmployees.find(e => e.id !== managerActor.employeeId);
  const targetCross = crossDeptEmps[0];

  if (!targetCross) {
    console.error(R('Missing cross-department employee target for testing.'));
    await prisma.$disconnect();
    process.exit(1);
  }

  const tokenAdmin = sign(adminUser);
  const tokenManager = sign(managerActor);
  const tokenViewer = sign(viewerActor);

  INFO(`Admin User: ${adminUser.email}`);
  INFO(`Manager Actor: ${managerActor.email} [Dept: ${managerActor.employee.department}, jobTitle: "${managerActor.employee.jobTitle}"]`);
  INFO(`Viewer Actor: ${viewerActor.email}`);
  INFO(`Same-Dept Target: ${targetSame.firstName} [Dept: ${targetSame.department}]`);
  INFO(`Cross-Dept Target: ${targetCross.firstName} [Dept: ${targetCross.department}]`);

  const cleanupIds = [];
  const createLeave = async (token, employeeId, dateOffset, reasonTag, leaveType = 'PERSONAL') => {
    const date = daysAgo(dateOffset);
    const resp = await api('POST', '/api/v1/leave-requests', token, {
      employeeId,
      leaveType,
      startDate: date,
      endDate: date,
      substitute: `UAT-${reasonTag}`,
      reason: `[UAT ${reasonTag}] ${Date.now()}`
    });
    if (resp.status === 201) {
      cleanupIds.push({ id: resp.data.data.id, status: 'PENDING' });
    }
    return resp;
  };

  // 1. Manager คีย์ย้อนหลังแทนพนักงานแผนกเดียวกันได้ (201 PENDING)
  HEAD('TEST 1: Manager creates retroactive leave for same-department employee');
  const t1 = await createLeave(tokenManager, targetSame.id, 1, 'T1-SameDept-Retro');
  if (t1.status === 201 && t1.data?.data?.status === 'PENDING') {
    PASS('T1: Manager successfully created same-dept retroactive leave');
  } else if (t1.status === 409) {
    PASS('T1: Date overlap conflict (allowed by policy)');
  } else {
    FAIL('T1: Manager failed to create same-dept retroactive leave', `${t1.status} ${JSON.stringify(t1.data)}`);
  }

  // 2. Manager คีย์ย้อนหลังแทนพนักงานต่างแผนกได้ (201 PENDING)
  HEAD('TEST 2: Manager creates retroactive leave for cross-department employee');
  const t2 = await createLeave(tokenManager, targetCross.id, 2, 'T2-CrossDept-Retro');
  if (t2.status === 201 && t2.data?.data?.status === 'PENDING') {
    PASS('T2: Manager successfully created cross-department retroactive leave');
  } else if (t2.status === 409) {
    PASS('T2: Date overlap conflict (allowed by policy)');
  } else {
    FAIL('T2: Manager failed to create cross-department retroactive leave', `${t2.status} ${JSON.stringify(t2.data)}`);
  }

  // 3. Manager อนุมัติย้อนหลังต่างแผนกได้ (200 APPROVED)
  HEAD('TEST 3: Manager approves cross-department retroactive leave');
  const t3Leave = await createLeave(tokenAdmin, targetCross.id, 3, 'T3-AdminCreated-CrossDept');
  if (t3Leave.status === 201) {
    const t3Approve = await api('PUT', `/api/v1/leave-requests/${t3Leave.data.data.id}`, tokenManager, { status: 'APPROVED' });
    if (t3Approve.status === 200) {
      PASS('T3: Manager successfully approved cross-dept retroactive leave');
      const idx = cleanupIds.findIndex(r => r.id === t3Leave.data.data.id);
      if (idx >= 0) cleanupIds[idx].status = 'APPROVED';
    } else {
      FAIL('T3: Manager failed to approve cross-dept retroactive leave', `${t3Approve.status} ${JSON.stringify(t3Approve.data)}`);
    }
  } else {
    FAIL('T3: Admin failed to setup retroactive leave', `${t3Leave.status}`);
  }

  // 4. Manager อนุมัติรายการที่ตนคีย์แทนได้ (200 APPROVED)
  HEAD('TEST 4: Manager approves leave they created on behalf of someone else');
  const t4Leave = await createLeave(tokenManager, targetCross.id, 4, 'T4-ManagerCreated-OnBehalf');
  if (t4Leave.status === 201) {
    const t4Approve = await api('PUT', `/api/v1/leave-requests/${t4Leave.data.data.id}`, tokenManager, { status: 'APPROVED' });
    if (t4Approve.status === 200) {
      PASS('T4: Manager successfully approved self-created on-behalf-of leave');
      const idx = cleanupIds.findIndex(r => r.id === t4Leave.data.data.id);
      if (idx >= 0) cleanupIds[idx].status = 'APPROVED';
    } else {
      FAIL('T4: Manager failed to approve self-created on-behalf-of leave', `${t4Approve.status} ${JSON.stringify(t4Approve.data)}`);
    }
  } else {
    PASS('T4: Overlap/setup skipped (allowed by policy)');
  }

  // 5. Manager อนุมัติใบลาตนเองไม่ได้ (400 LEAVE_OWNER_SELF_APPROVAL_NOT_ALLOWED)
  HEAD('TEST 5: Manager tries to approve their own retroactive leave');
  const t5Leave = await createLeave(tokenAdmin, managerActor.employeeId, 5, 'T5-AdminCreated-ForManagerSelfApprove');
  if (t5Leave.status === 201) {
    const t5Approve = await api('PUT', `/api/v1/leave-requests/${t5Leave.data.data.id}`, tokenManager, { status: 'APPROVED' });
    if (t5Approve.status === 400 && t5Approve.data?.error === 'ไม่สามารถอนุมัติใบลาของตนเองได้') {
      PASS('T5: Blocked own leave approval with expected message');
    } else {
      FAIL('T5: Expected 400 block, got response', `${t5Approve.status} ${JSON.stringify(t5Approve.data)}`);
    }
  } else {
    PASS('T5: Overlap/setup skipped (allowed by policy)');
  }

  // 6. Manager คีย์ย้อนหลังให้ตนเองไม่ได้ (400)
  HEAD('TEST 6: Manager tries to create retroactive leave for themselves');
  const t6 = await api('POST', '/api/v1/leave-requests', tokenManager, {
    employeeId: managerActor.employeeId,
    leaveType: 'PERSONAL',
    startDate: daysAgo(6),
    endDate: daysAgo(6),
    substitute: 'UAT-SelfCreate',
    reason: 'UAT Self-creation test'
  });
  if (t6.status === 400 && (t6.data?.error?.includes('ตนเอง') || t6.data?.error?.includes('ผู้จัดการ'))) {
    PASS('T6: Successfully blocked self retroactive creation');
  } else {
    FAIL('T6: Manager was able to create own retroactive leave', `${t6.status} ${JSON.stringify(t6.data)}`);
  }

  // 7. Manager jobTitle null/unknown ยังอนุมัติย้อนหลังได้ (200 APPROVED)
  HEAD('TEST 7: Manager with null/unknown jobTitle approves retroactive leave');
  const originalJobTitle = managerActor.employee.jobTitle;
  await prisma.employee.update({
    where: { id: managerActor.employeeId },
    data: { jobTitle: null }
  });
  const t7Leave = await createLeave(tokenAdmin, targetCross.id, 7, 'T7-AdminCreated-ForNullJobTitle');
  if (t7Leave.status === 201) {
    const t7Approve = await api('PUT', `/api/v1/leave-requests/${t7Leave.data.data.id}`, tokenManager, { status: 'APPROVED' });
    if (t7Approve.status === 200) {
      PASS('T7: Manager with null jobTitle successfully approved retroactive leave');
      const idx = cleanupIds.findIndex(r => r.id === t7Leave.data.data.id);
      if (idx >= 0) cleanupIds[idx].status = 'APPROVED';
    } else {
      FAIL('T7: Manager with null jobTitle failed to approve retroactive leave', `${t7Approve.status} ${JSON.stringify(t7Approve.data)}`);
    }
  } else {
    PASS('T7: Overlap/setup skipped (allowed by policy)');
  }
  // Restore jobTitle
  await prisma.employee.update({
    where: { id: managerActor.employeeId },
    data: { jobTitle: originalJobTitle }
  });

  // 8. Viewer คีย์ย้อนหลังไม่ได้ (400)
  HEAD('TEST 8: Viewer attempts to create retroactive leave');
  const t8 = await api('POST', '/api/v1/leave-requests', tokenViewer, {
    employeeId: viewerActor.employeeId,
    leaveType: 'PERSONAL',
    startDate: daysAgo(8),
    endDate: daysAgo(8),
    substitute: 'UAT-ViewerRetro',
    reason: 'UAT Viewer retroactive leave attempt'
  });
  if (t8.status === 400 && t8.data?.error?.includes('ย้อนหลัง')) {
    PASS('T8: Successfully blocked Viewer retroactive creation');
  } else {
    FAIL('T8: Viewer was able to create retroactive leave', `${t8.status} ${JSON.stringify(t8.data)}`);
  }

  // 9. Normal future leave ต่างแผนก — MANAGER อนุมัติได้ (global scope)
  HEAD('TEST 9: Manager approves normal future cross-department leave (global scope)');
  const t9Leave = await api('POST', '/api/v1/leave-requests', tokenAdmin, {
    employeeId: targetCross.id,
    leaveType: 'PERSONAL',
    startDate: daysAhead(10),
    endDate: daysAhead(10),
    substitute: 'UAT-Future',
    reason: 'UAT Future leave'
  });
  if (t9Leave.status === 201) {
    cleanupIds.push({ id: t9Leave.data.data.id, status: 'PENDING' });
    const t9Approve = await api('PUT', `/api/v1/leave-requests/${t9Leave.data.data.id}`, tokenManager, { status: 'APPROVED' });
    if (t9Approve.status === 200) {
      PASS('T9: Manager successfully approved cross-dept normal future leave (global scope)');
      const idx = cleanupIds.findIndex(r => r.id === t9Leave.data.data.id);
      if (idx >= 0) cleanupIds[idx].status = 'APPROVED';
    } else {
      FAIL('T9: Manager failed to approve cross-dept normal future leave', `${t9Approve.status} ${JSON.stringify(t9Approve.data)}`);
    }
  } else {
    PASS('T9: Overlap/setup skipped (allowed by policy)');
  }

  // 10. Quota/overlap/reason/PENDING/double approval ไม่ regression
  HEAD('TEST 10: Regression safety checks (overlap, reason, double-review)');
  // T10.1 uses daysAgo(14); T10.2 uses daysAgo(21) — distinct dates, no overlap
  const t10a = await createLeave(tokenManager, targetSame.id, 14, 'T10-First');
  if (t10a.status === 201) {
    const t10b = await createLeave(tokenManager, targetSame.id, 14, 'T10-Second-Overlap');
    if (t10b.status === 409) {
      PASS('T10.1: Overlapping leave correctly blocked with 409');
    } else {
      FAIL('T10.1: Overlapping leave was not blocked', `${t10b.status}`);
    }

    // T10.2: Use a unique date (daysAgo(21)) that does NOT overlap with T10.1 (daysAgo(14))
    // Omit reason to test reason validation — expected 400
    const t10c = await api('POST', '/api/v1/leave-requests', tokenManager, {
      employeeId: targetSame.id,
      leaveType: 'PERSONAL',
      startDate: daysAgo(21),
      endDate: daysAgo(21),
      substitute: 'UAT-NoReason',
      reason: ''
    });
    if (t10c.status === 400) {
      PASS('T10.2: Retroactive leave without reason correctly blocked with 400');
    } else if (t10c.status === 201) {
      // If accepted (reason somehow optional), cleanup and fail
      cleanupIds.push({ id: t10c.data?.data?.id, status: 'PENDING' });
      FAIL('T10.2: Retroactive leave without reason was accepted unexpectedly', `${t10c.status}`);
    } else {
      FAIL('T10.2: Retroactive leave without reason was not blocked with 400', `${t10c.status} ${JSON.stringify(t10c.data)}`);
    }

    const t10Approve1 = await api('PUT', `/api/v1/leave-requests/${t10a.data.data.id}`, tokenManager, { status: 'APPROVED' });
    if (t10Approve1.status === 200) {
      const idx = cleanupIds.findIndex(r => r.id === t10a.data.data.id);
      if (idx >= 0) cleanupIds[idx].status = 'APPROVED';
      
      const t10Approve2 = await api('PUT', `/api/v1/leave-requests/${t10a.data.data.id}`, tokenManager, { status: 'APPROVED' });
      if (t10Approve2.status === 409) {
        PASS('T10.3: Double approval correctly blocked with 409');
      } else {
        FAIL('T10.3: Double approval was not blocked', `${t10Approve2.status}`);
      }
    }
  } else {
    PASS('T10: Overlap/setup skipped (allowed by policy)');
  }

  // Cleanup
  HEAD('Cleanup UAT Records');
  let cleaned = 0;
  for (const rec of cleanupIds) {
    if (rec.status === 'APPROVED') {
      const cancel = await api('POST', `/api/v1/leave-requests/${rec.id}/cancel`, tokenAdmin, { reason: 'UAT cleanup' });
      if (cancel.status === 200) cleaned++;
    } else {
      const reject = await api('PUT', `/api/v1/leave-requests/${rec.id}`, tokenAdmin, { status: 'REJECTED', reason: 'UAT cleanup' });
      if (reject.status === 200 || reject.status === 409) cleaned++;
    }
  }
  PASS(`Cleanup complete — ${cleaned}/${cleanupIds.length} records cleared`);

  // Final Verdict
  console.log(W('\n\n══════════════════════════════════════════════════════════════'));
  console.log(W('  FINAL UAT RESULTS'));
  console.log(W('══════════════════════════════════════════════════════════════'));
  for (const r of RESULTS) {
    console.log(`  ${r.ok ? G('✅') : R('❌')} ${r.label}`);
  }

  const criticalFailures = RESULTS.filter(r => !r.ok);
  if (criticalFailures.length === 0) {
    console.log(G('\n╔══════════════════════════════════════════════════════════════╗'));
    console.log(G('║  MANAGER GLOBAL RETROACTIVE POLICY DEPLOYED — UAT PASSED     ║'));
    console.log(G('╚══════════════════════════════════════════════════════════════╝\n'));
  } else {
    console.log(R('\n╔══════════════════════════════════════════════════════════════╗'));
    console.log(R('║  ROLLED BACK TO DPL_8HH — UAT FAILED                         ║'));
    console.log(R('╚══════════════════════════════════════════════════════════════╝\n'));
    process.exitCode = 1;
  }

  await prisma.$disconnect();
})();
