'use strict';

const HttpError = require('../utils/http-error');
const { detectedType } = require('./employee-reference-photo-storage.service');

const PROVIDER_NAME = 'SELF_HOSTED_FACE_MATCH_V1';
const VERIFICATION_MODE = 'FACE_MATCH_ONLY';
const POLICY_PROFILE_ID = 'FACE_MATCH_ONLY_V1';
const MAX_LIVE_PHOTO_SIZE = 2 * 1024 * 1024;
const MAX_REFERENCE_PHOTO_SIZE = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;

function http(statusCode, code, message) {
  return new HttpError(statusCode, message, { code });
}

function verifierConfig(environment = process.env) {
  const rawUrl = String(environment.FACE_VERIFIER_URL || '').trim();
  const token = String(environment.FACE_VERIFIER_SHARED_TOKEN || '').trim();
  if (!rawUrl || !token) throw http(503, 'VERIFICATION_PROVIDER_UNAVAILABLE', 'Trusted face verifier is not configured.');
  let url;
  try { url = new URL(rawUrl); } catch { throw http(503, 'VERIFICATION_PROVIDER_UNAVAILABLE', 'Trusted face verifier is not configured.'); }
  const localTest = environment.NODE_ENV === 'test' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if (url.protocol !== 'https:' && !localTest) throw http(503, 'VERIFICATION_PROVIDER_UNAVAILABLE', 'Trusted face verifier must use HTTPS.');
  if (token.length < 16 || token.length > 4096) throw http(503, 'VERIFICATION_PROVIDER_UNAVAILABLE', 'Trusted face verifier is not configured.');
  return { url: url.toString(), token };
}

function validateImageBytes(buffer, maxBytes, code) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 64 || buffer.length > maxBytes || !detectedType(buffer)) {
    throw http(400, code, 'Face verification image is invalid.');
  }
  return buffer;
}

function safeText(value, max) {
  const text = value == null ? '' : String(value).trim();
  return text ? text.slice(0, max) : null;
}

function createSelfHostedFaceMatchProvider({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  return {
    name: PROVIDER_NAME,
    verificationMode: VERIFICATION_MODE,
    publicConfig() {
      return Object.freeze({ provider: PROVIDER_NAME, verificationMode: VERIFICATION_MODE, storesLivePhoto: false });
    },
    async evaluate({ providerSessionRef, livePhotoBytes, referencePhotoBytes }) {
      const config = verifierConfig(environment);
      const live = validateImageBytes(livePhotoBytes, MAX_LIVE_PHOTO_SIZE, 'LIVE_FACE_PHOTO_INVALID');
      const reference = validateImageBytes(referencePhotoBytes, MAX_REFERENCE_PHOTO_SIZE, 'FACE_REFERENCE_INVALID');
      const sessionRef = safeText(providerSessionRef, 1000);
      if (!sessionRef) throw http(400, 'VERIFICATION_PROVIDER_SESSION_INVALID', 'Provider session metadata is required.');
      if (typeof fetchImpl !== 'function' || typeof FormData !== 'function' || typeof Blob !== 'function') {
        throw http(503, 'VERIFICATION_PROVIDER_UNAVAILABLE', 'Trusted face verifier is unavailable.');
      }

      const form = new FormData();
      form.set('requestRef', sessionRef);
      form.set('mode', VERIFICATION_MODE);
      form.set('livePhoto', new Blob([live], { type: detectedType(live) === 'png' ? 'image/png' : 'image/jpeg' }), 'live-photo');
      form.set('referencePhoto', new Blob([reference], { type: detectedType(reference) === 'png' ? 'image/png' : 'image/jpeg' }), 'reference-photo');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(Number(timeoutMs) || REQUEST_TIMEOUT_MS, 30_000)));
      let response;
      try {
        response = await fetchImpl(config.url, {
          method: 'POST',
          headers: { authorization: `Bearer ${config.token}`, accept: 'application/json' },
          body: form,
          signal: controller.signal
        });
      } catch {
        throw http(503, 'VERIFICATION_PROVIDER_UNAVAILABLE', 'Trusted face verifier is temporarily unavailable.');
      } finally {
        clearTimeout(timer);
      }
      if (!response?.ok) throw http(503, 'VERIFICATION_PROVIDER_UNAVAILABLE', 'Trusted face verifier is temporarily unavailable.');

      let body;
      try { body = await response.json(); } catch { throw http(502, 'VERIFICATION_PROVIDER_RESULT_INVALID', 'Trusted face verifier returned an invalid result.'); }
      if (!body || typeof body.match !== 'boolean') throw http(502, 'VERIFICATION_PROVIDER_RESULT_INVALID', 'Trusted face verifier returned an invalid result.');
      return Object.freeze({
        faceMatchPassed: body.match === true,
        resultCode: safeText(body.resultCode, 80) || (body.match ? 'FACE_MATCH' : 'FACE_NO_MATCH'),
        policyProfileId: safeText(body.policyProfileId, 120) || POLICY_PROFILE_ID,
        engineVersion: safeText(body.engineVersion, 120),
        providerSessionRef: sessionRef
      });
    }
  };
}

module.exports = {
  PROVIDER_NAME,
  VERIFICATION_MODE,
  POLICY_PROFILE_ID,
  MAX_LIVE_PHOTO_SIZE,
  MAX_REFERENCE_PHOTO_SIZE,
  REQUEST_TIMEOUT_MS,
  verifierConfig,
  createSelfHostedFaceMatchProvider
};
