'use strict';

// Announcements (Owner batch 12 B, 31 Oct 2026).
// - Read: every authenticated user, limited by site scope. ADMIN/MANAGER/SUPERVISOR read every site
//   (same cross-department policy as report-scope.js); other roles read global announcements plus
//   announcements of the security sites they are rostered on (ShiftAssignment ±30 days).
// - Write: ADMIN only, enforced here and at the route layer. Every mutation is audited.
// - Expiry: a calendar date; the announcement stays visible until the end of that day in Asia/Bangkok.
// - Delete is soft (deletedAt); rows are never physically removed by the API.
// - Text only: title/body are stored and returned as plain text; the UI never renders HTML.

const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');

const ANNOUNCEMENT_CATEGORIES = Object.freeze(['GENERAL', 'POLICY', 'EVENT']);
const ALL_SITE_ROLES = new Set(['ADMIN', 'MANAGER', 'SUPERVISOR']);
const BANGKOK_OFFSET_MS = 7 * 3600000;
const DAY_MS = 86400000;
const SCOPE_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 50;

function http(statusCode, code, message) { return new HttpError(statusCode, message, { code }); }

function roleOf(actor) { return String(actor?.role || '').toUpperCase(); }

function requireAdmin(actor) {
  if (roleOf(actor) !== 'ADMIN') throw http(403, 'ANNOUNCEMENT_ADMIN_REQUIRED', 'Only ADMIN may manage announcements.');
}

function bangkokDateText(date) {
  return new Date(date.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

// '2026-10-31' -> 2026-10-31T17:00:00Z (= 2026-11-01 00:00 Asia/Bangkok), exclusive end.
function bangkokEndOfDay(dateText) {
  const text = String(dateText || '');
  const day = new Date(`${text}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== text) {
    throw http(400, 'ANNOUNCEMENT_EXPIRY_INVALID', 'Announcement expiry date is invalid.');
  }
  return new Date(day.getTime() + DAY_MS - BANGKOK_OFFSET_MS);
}

function expiresOnOf(expiresAt) {
  if (!expiresAt) return null;
  return bangkokDateText(new Date(new Date(expiresAt).getTime() - 1));
}

function cleanText(value, max, field) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) throw http(400, 'ANNOUNCEMENT_FIELD_REQUIRED', `${field} is required.`);
  if (text.length > max) throw http(400, 'ANNOUNCEMENT_FIELD_TOO_LONG', `${field} is too long.`);
  return text;
}

function present(row, now) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    category: row.category,
    pinned: Boolean(row.pinned),
    siteId: row.siteId ?? null,
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    expiresOn: expiresOnOf(row.expiresAt),
    expired: Boolean(row.expiresAt && new Date(row.expiresAt) <= now),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null
  };
}

function createAnnouncementService({ prisma = prismaDefault, audit = auditDefault, clock = () => new Date() } = {}) {
  async function viewerSiteIds(actor, now) {
    const employeeId = actor?.employeeAuthority?.id || actor?.employeeId || null;
    if (!employeeId) return [];
    const today = new Date(`${bangkokDateText(now)}T00:00:00.000Z`);
    const rows = await prisma.shiftAssignment.findMany({
      where: {
        employeeId,
        securitySiteId: { not: null },
        workDate: { gte: new Date(today.getTime() - SCOPE_WINDOW_DAYS * DAY_MS), lte: new Date(today.getTime() + SCOPE_WINDOW_DAYS * DAY_MS) }
      },
      select: { securitySiteId: true },
      distinct: ['securitySiteId']
    });
    return [...new Set(rows.map((row) => row.securitySiteId).filter(Boolean))];
  }

  async function assertSite(client, siteId) {
    if (!siteId) return null;
    const site = await client.securitySite.findUnique({ where: { id: siteId }, select: { id: true } });
    if (!site) throw http(400, 'ANNOUNCEMENT_SITE_NOT_FOUND', 'Security site does not exist.');
    return siteId;
  }

  function assertFutureExpiry(expiresOn, now) {
    if (expiresOn == null) return null;
    const end = bangkokEndOfDay(expiresOn);
    if (end <= now) throw http(400, 'ANNOUNCEMENT_EXPIRY_PAST', 'Announcement expiry date must be today or later.');
    return end;
  }

  async function list({ actor, query = {} }) {
    const now = clock();
    const role = roleOf(actor);
    const and = [{ deletedAt: null }];
    if (!(query.includeExpired && role === 'ADMIN')) and.push({ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });
    if (query.category) and.push({ category: query.category });
    if (!ALL_SITE_ROLES.has(role)) {
      const sites = await viewerSiteIds(actor, now);
      and.push({ OR: [{ siteId: null }, ...(sites.length ? [{ siteId: { in: sites } }] : [])] });
    } else if (query.siteId) {
      and.push({ OR: [{ siteId: null }, { siteId: { in: [query.siteId] } }] });
    }
    const rows = await prisma.announcement.findMany({
      where: { AND: and },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(Number(query.limit) || DEFAULT_LIMIT, 100)
    });
    return rows.map((row) => present(row, now));
  }

  async function create({ actor, input }) {
    requireAdmin(actor);
    const now = clock();
    const data = {
      title: cleanText(input.title, 150, 'title'),
      body: cleanText(input.body, 5000, 'body'),
      category: ANNOUNCEMENT_CATEGORIES.includes(input.category) ? input.category : (() => { throw http(400, 'ANNOUNCEMENT_CATEGORY_INVALID', 'Announcement category is invalid.'); })(),
      pinned: Boolean(input.pinned),
      expiresAt: assertFutureExpiry(input.expiresOn ?? null, now),
      createdBy: actor.sub
    };
    return prisma.$transaction(async (tx) => {
      data.siteId = await assertSite(tx, input.siteId || null);
      const row = await tx.announcement.create({ data });
      await audit.log({ actorUserId: actor.sub, action: 'CREATE', entityType: 'Announcement', entityId: row.id, metadata: { category: row.category, pinned: row.pinned, siteId: row.siteId ?? null, expiresOn: expiresOnOf(row.expiresAt) } }, tx);
      return present(row, now);
    });
  }

  async function findLive(client, id) {
    const row = await client.announcement.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw http(404, 'ANNOUNCEMENT_NOT_FOUND', 'Announcement not found.');
    return row;
  }

  async function update({ actor, id, input }) {
    requireAdmin(actor);
    const now = clock();
    return prisma.$transaction(async (tx) => {
      const before = await findLive(tx, id);
      const data = { updatedBy: actor.sub };
      if (input.title !== undefined) data.title = cleanText(input.title, 150, 'title');
      if (input.body !== undefined) data.body = cleanText(input.body, 5000, 'body');
      if (input.category !== undefined) {
        if (!ANNOUNCEMENT_CATEGORIES.includes(input.category)) throw http(400, 'ANNOUNCEMENT_CATEGORY_INVALID', 'Announcement category is invalid.');
        data.category = input.category;
      }
      if (input.pinned !== undefined) data.pinned = Boolean(input.pinned);
      if (input.expiresOn !== undefined) data.expiresAt = assertFutureExpiry(input.expiresOn, now);
      if (input.siteId !== undefined) data.siteId = await assertSite(tx, input.siteId || null);
      const row = await tx.announcement.update({ where: { id }, data });
      await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'Announcement', entityId: id, metadata: { changedFields: Object.keys(data).filter((key) => key !== 'updatedBy'), pinnedBefore: before.pinned, pinnedAfter: row.pinned } }, tx);
      return present(row, now);
    });
  }

  async function remove({ actor, id }) {
    requireAdmin(actor);
    const now = clock();
    return prisma.$transaction(async (tx) => {
      await findLive(tx, id);
      await tx.announcement.update({ where: { id }, data: { deletedAt: now, updatedBy: actor.sub } });
      await audit.log({ actorUserId: actor.sub, action: 'DELETE', entityType: 'Announcement', entityId: id, metadata: { soft: true } }, tx);
      return { id, deleted: true };
    });
  }

  return { list, create, update, remove };
}

module.exports = { createAnnouncementService, bangkokEndOfDay, expiresOnOf, ANNOUNCEMENT_CATEGORIES };
