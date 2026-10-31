'use strict';

// Announcements (Owner batch 12 B, 31 Oct 2026).
// - Read: every authenticated user of every role (incl. employee/PWA accounts) reads ALL live
//   announcements. Owner decision 31 Oct 2026: no site/department scope filtering.
// - Write: ADMIN only, enforced here and at the route layer. Every mutation is audited.
// - Expiry: a calendar date; the announcement stays visible until the end of that day in Asia/Bangkok.
// - Delete is soft (deletedAt); rows are never physically removed by the API.
// - Text only: title/body are stored and returned as plain text; the UI never renders HTML.

const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const crypto = require('node:crypto');
const HttpError = require('../utils/http-error');

const ANNOUNCEMENT_CATEGORIES = Object.freeze(['GENERAL', 'POLICY', 'EVENT']);
const BANGKOK_OFFSET_MS = 7 * 3600000;
const DAY_MS = 86400000;
const DEFAULT_LIMIT = 50;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = Object.freeze({ jpeg: { mime: 'image/jpeg', ext: 'jpg' }, png: { mime: 'image/png', ext: 'png' }, webp: { mime: 'image/webp', ext: 'webp' } });

function imageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

function normalizeImage(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) throw http(400, 'ANNOUNCEMENT_IMAGE_REQUIRED', 'An image file is required.');
  if (file.buffer.length > MAX_IMAGE_BYTES) throw http(413, 'ANNOUNCEMENT_IMAGE_TOO_LARGE', 'Announcement image must not exceed 5 MB.');
  const type = IMAGE_TYPES[imageType(file.buffer)];
  if (!type || (file.mimetype && String(file.mimetype).toLowerCase() !== type.mime)) throw http(415, 'ANNOUNCEMENT_IMAGE_INVALID', 'Announcement image must be a valid JPEG, PNG or WebP image.');
  return { buffer: file.buffer, mimeType: type.mime, extension: type.ext, checksum: crypto.createHash('sha256').update(file.buffer).digest('hex') };
}

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
    showPopup: Boolean(row.showPopup),
    hasImage: Boolean(row.imageObjectKey),
    imageUrl: row.imageObjectKey ? `/api/v1/announcements/${row.id}/image?v=${String(row.imageChecksum || '').slice(0, 12)}` : null,
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    expiresOn: expiresOnOf(row.expiresAt),
    expired: Boolean(row.expiresAt && new Date(row.expiresAt) <= now),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null
  };
}

function createAnnouncementService({ prisma = prismaDefault, audit = auditDefault, storage = null, clock = () => new Date() } = {}) {
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
    const rows = await prisma.announcement.findMany({
      where: { AND: and },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(Number(query.limit) || DEFAULT_LIMIT, 100)
    });
    return rows.map((row) => present(row, now));
  }

  async function get({ actor, id }) {
    const now = clock();
    const row = await prisma.announcement.findFirst({ where: { id, deletedAt: null } });
    if (!row || (row.expiresAt && new Date(row.expiresAt) <= now && roleOf(actor) !== 'ADMIN')) throw http(404, 'ANNOUNCEMENT_NOT_FOUND', 'Announcement not found.');
    return present(row, now);
  }

  async function create({ actor, input }) {
    requireAdmin(actor);
    const now = clock();
    const data = {
      title: cleanText(input.title, 150, 'title'),
      body: cleanText(input.body, 5000, 'body'),
      category: ANNOUNCEMENT_CATEGORIES.includes(input.category) ? input.category : (() => { throw http(400, 'ANNOUNCEMENT_CATEGORY_INVALID', 'Announcement category is invalid.'); })(),
      pinned: Boolean(input.pinned),
      showPopup: Boolean(input.showPopup),
      expiresAt: assertFutureExpiry(input.expiresOn ?? null, now),
      createdBy: actor.sub
    };
    return prisma.$transaction(async (tx) => {
      const row = await tx.announcement.create({ data });
      await audit.log({ actorUserId: actor.sub, action: 'CREATE', entityType: 'Announcement', entityId: row.id, metadata: { category: row.category, pinned: row.pinned, expiresOn: expiresOnOf(row.expiresAt) } }, tx);
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
      if (input.showPopup !== undefined) data.showPopup = Boolean(input.showPopup);
      if (input.expiresOn !== undefined) data.expiresAt = assertFutureExpiry(input.expiresOn, now);
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

  async function popups({ actor }) {
    const now = clock();
    const rows = await prisma.announcement.findMany({
      where: { AND: [{ deletedAt: null }, { showPopup: true }, { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }] },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: 20
    });
    void actor;
    return rows.map((row) => present(row, now));
  }

  function store() {
    if (!storage || typeof storage.put !== 'function') throw http(503, 'ANNOUNCEMENT_STORAGE_NOT_CONFIGURED', 'Announcement image storage is not configured.');
    return storage;
  }

  async function setImage({ actor, id, file }) {
    requireAdmin(actor);
    const now = clock();
    const image = normalizeImage(file);
    const previousKey = (await findLive(prisma, id)).imageObjectKey || null;
    const month = new Date(now.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 7);
    const key = `announcement/${month}/${crypto.randomUUID()}.${image.extension}`;
    const objects = store();
    await objects.put(key, { buffer: image.buffer, mimetype: image.mimeType, size: image.buffer.length });
    let row;
    try {
      row = await prisma.$transaction(async (tx) => {
        const updated = await tx.announcement.update({ where: { id }, data: { imageObjectKey: key, imageMimeType: image.mimeType, imageSizeBytes: image.buffer.length, imageChecksum: image.checksum, updatedBy: actor.sub } });
        await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'Announcement', entityId: id, metadata: { event: 'ANNOUNCEMENT_IMAGE_SET', mimeType: image.mimeType, sizeBytes: image.buffer.length, replaced: Boolean(previousKey) } }, tx);
        return updated;
      });
    } catch (error) {
      await objects.remove(key).catch(() => undefined);
      throw error;
    }
    if (previousKey) await objects.remove(previousKey).catch(() => undefined);
    return present(row, now);
  }

  async function removeImage({ actor, id }) {
    requireAdmin(actor);
    const now = clock();
    const previousKey = (await findLive(prisma, id)).imageObjectKey || null;
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.announcement.update({ where: { id }, data: { imageObjectKey: null, imageMimeType: null, imageSizeBytes: null, imageChecksum: null, updatedBy: actor.sub } });
      await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'Announcement', entityId: id, metadata: { event: 'ANNOUNCEMENT_IMAGE_REMOVED', hadImage: Boolean(previousKey) } }, tx);
      return updated;
    });
    if (previousKey) await store().remove(previousKey).catch(() => undefined);
    return present(row, now);
  }

  async function image({ actor, id }) {
    const now = clock();
    const row = await prisma.announcement.findFirst({ where: { id, deletedAt: null } });
    if (!row || !row.imageObjectKey || (row.expiresAt && new Date(row.expiresAt) <= now && roleOf(actor) !== 'ADMIN')) throw http(404, 'ANNOUNCEMENT_IMAGE_NOT_FOUND', 'Announcement image not found.');
    const bytes = await store().get(row.imageObjectKey);
    if (!Buffer.isBuffer(bytes) || crypto.createHash('sha256').update(bytes).digest('hex') !== row.imageChecksum) throw http(502, 'ANNOUNCEMENT_IMAGE_READ_FAILED', 'Announcement image could not be verified.');
    return { bytes, mimeType: row.imageMimeType };
  }

  return { list, get, popups, create, update, remove, setImage, removeImage, image };
}

module.exports = { createAnnouncementService, bangkokEndOfDay, expiresOnOf, imageType, ANNOUNCEMENT_CATEGORIES, MAX_IMAGE_BYTES };
