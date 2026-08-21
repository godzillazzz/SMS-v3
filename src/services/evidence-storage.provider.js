'use strict';

const REQUIRED_METHODS = ['putIfAbsent', 'verify', 'createReadHandle', 'remove', 'healthCheck'];
const EVIDENCE_INTEGRITY_CONFLICT = 'EVIDENCE_INTEGRITY_CONFLICT';
const PRIVATE_STORAGE_PROVIDER_NOT_CONFIGURED = 'PRIVATE_STORAGE_PROVIDER_NOT_CONFIGURED';

function createEvidenceStorageProvider(provider) {
  if (!provider || REQUIRED_METHODS.some((method) => typeof provider[method] !== 'function')) {
    throw new TypeError('Evidence storage provider does not implement the required contract.');
  }
  return Object.freeze(Object.fromEntries(REQUIRED_METHODS.map((method) => [method, (...args) => provider[method](...args)])));
}

function assertChecksumCompatible(existingChecksum, incomingChecksum) {
  if (existingChecksum && incomingChecksum && existingChecksum !== incomingChecksum) {
    const error = new Error('Evidence checksum conflicts with the existing capture.');
    error.code = EVIDENCE_INTEGRITY_CONFLICT;
    throw error;
  }
  return { idempotent: Boolean(existingChecksum && incomingChecksum) };
}

function createUnconfiguredEvidenceStorageProvider() {
  const unavailable = async () => {
    const error = new Error('Private evidence storage is not configured.');
    error.code = PRIVATE_STORAGE_PROVIDER_NOT_CONFIGURED;
    throw error;
  };
  return createEvidenceStorageProvider({
    putIfAbsent: unavailable,
    verify: unavailable,
    createReadHandle: unavailable,
    remove: unavailable,
    healthCheck: unavailable
  });
}

module.exports = {
  EVIDENCE_INTEGRITY_CONFLICT,
  PRIVATE_STORAGE_PROVIDER_NOT_CONFIGURED,
  REQUIRED_METHODS,
  assertChecksumCompatible,
  createEvidenceStorageProvider,
  createUnconfiguredEvidenceStorageProvider
};
