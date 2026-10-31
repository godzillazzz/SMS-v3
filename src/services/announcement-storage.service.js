'use strict';

// Announcement images reuse the already-provisioned Patrol/selfie private bucket
// (PATROL_PHOTOS_BUCKET || ATTENDANCE_DEVICE_SELFIE_BUCKET) under the dedicated `announcement/`
// prefix. No new bucket, env variable or credential is required.
const HttpError = require('../utils/http-error');
const { selectPatrolStorage } = require('./patrol-storage.service');

const ANNOUNCEMENT_KEY = /^announcement\/\d{4}-\d{2}\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/;

function assertAnnouncementKey(key) {
  if (typeof key !== 'string' || !ANNOUNCEMENT_KEY.test(key)) throw new HttpError(400, 'Announcement object key is invalid.', { code: 'ANNOUNCEMENT_OBJECT_KEY_INVALID' });
  return key;
}

function lazyAnnouncementStorage(options = {}) {
  let instance;
  const resolve = () => { instance = instance || selectPatrolStorage({ ...options, assertKey: assertAnnouncementKey }); return instance; };
  return {
    get provider() { return resolve().provider; },
    get bucket() { return resolve().bucket; },
    put: (key, file) => resolve().put(key, file),
    remove: (key) => resolve().remove(key),
    get: (key) => resolve().get(key)
  };
}

module.exports = { assertAnnouncementKey, lazyAnnouncementStorage };
