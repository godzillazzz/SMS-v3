'use strict';

const LICENSE_DOCUMENT_HISTORY = /^\/api\/v1\/licenses\/[^/]+\/documents$/;
const FORBIDDEN_LICENSE_FIELDS = new Set([
  'storageobjectkey',
  'checksum',
  'signedurl',
  'storagecredentials',
  'storagetoken',
  'servicekey'
]);

function pathnameOnly(value) {
  try {
    return new URL(value, 'https://uat.invalid').pathname;
  } catch {
    return '';
  }
}

function normalizeNetworkPath(value) {
  const pathname = pathnameOnly(value);
  if (LICENSE_DOCUMENT_HISTORY.test(pathname)) return '/api/v1/licenses/{licenseId}/documents';
  return pathname;
}

function containsForbiddenLicenseField(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsForbiddenLicenseField);
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_LICENSE_FIELDS.has(String(key).toLowerCase())) return true;
    if (containsForbiddenLicenseField(nested)) return true;
  }
  return false;
}

function createBoundedNetworkObserver(page, { trackedPaths = [] } = {}) {
  const tracked = new Set(trackedPaths);
  const records = [];
  const listener = (response) => {
    const path = normalizeNetworkPath(response.url());
    if (!path || (tracked.size && !tracked.has(path))) return;
    records.push({
      method: response.request().method(),
      path,
      status: response.status()
    });
  };
  page.on('response', listener);

  return {
    count(path, { method = 'GET' } = {}) {
      return records.filter((record) => record.path === path && record.method === method).length;
    },
    statuses(path, { method = 'GET' } = {}) {
      return records.filter((record) => record.path === path && record.method === method).map((record) => record.status);
    },
    reset() {
      records.length = 0;
    },
    stop() {
      page.off('response', listener);
    }
  };
}

module.exports = {
  LICENSE_DOCUMENT_HISTORY,
  containsForbiddenLicenseField,
  createBoundedNetworkObserver,
  normalizeNetworkPath,
  pathnameOnly
};
