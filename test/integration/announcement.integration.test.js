'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
const configured = process.env.RUN_INTEGRATION_TESTS === 'true'
  && ['docker-container-network', 'local-isolated'].includes(process.env.TEST_DATABASE_RUNNER)
  && target.hostname === '127.0.0.1'
  && target.port === '5432'
  && ['sms_v3_test', 'forge_patrol_test', 'forge_b12b_test'].includes(target.pathname.replace(/^\//, ''));

if (!configured) {
  test('announcement integration requires the isolated test PostgreSQL target', { skip: true }, () => {});
} else {
  const { PrismaClient } = require('@prisma/client');
  const { createAnnouncementService } = require('../../src/services/announcement.service');
  const prisma = new PrismaClient();
  const marker = `IT-${crypto.randomUUID().slice(0, 8)}`;
  const admin = { sub: crypto.randomUUID(), role: 'ADMIN' };
  const service = createAnnouncementService({ prisma, audit: { log: async () => {} }, clock: () => new Date('2026-10-31T05:00:00.000Z') });

  test.after(async () => {
    await prisma.announcement.deleteMany({ where: { title: { startsWith: marker } } });
    await prisma.$disconnect();
  });

  test('announcement table round-trips: pinned first, Bangkok end-of-day expiry, soft delete, category CHECK', async () => {
    const plain = await service.create({ actor: admin, input: { title: `${marker} ทั่วไป`, body: 'ข้อความ', category: 'GENERAL', expiresOn: '2026-10-31' } });
    const pinned = await service.create({ actor: admin, input: { title: `${marker} ปักหมุด`, body: 'ข้อความ', category: 'POLICY', pinned: true } });
    assert.equal(plain.expiresAt, '2026-10-31T17:00:00.000Z');
    const list = (await service.list({ actor: admin, query: {} })).filter((row) => row.title.startsWith(marker));
    assert.deepEqual(list.map((row) => row.id), [pinned.id, plain.id]);
    await service.remove({ actor: admin, id: plain.id });
    const stored = await prisma.announcement.findUnique({ where: { id: plain.id } });
    assert.ok(stored.deletedAt);
    const after = (await service.list({ actor: admin, query: {} })).filter((row) => row.title.startsWith(marker));
    assert.deepEqual(after.map((row) => row.id), [pinned.id]);
    await assert.rejects(prisma.$executeRawUnsafe(`INSERT INTO announcements (title, body, category, created_by, updated_at) VALUES ('${marker} bad', 'x', 'OTHER', gen_random_uuid(), now())`));
  });
}
