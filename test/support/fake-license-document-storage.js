const crypto = require('node:crypto');

function createFakeLicenseDocumentStorage() {
  const objects = new Map();
  const calls = { put: [], remove: [], createSignedUrl: [] };
  const failures = { put: false, remove: false, createSignedUrl: false };
  return {
    calls,
    objects,
    failNextPut() { failures.put = true; },
    failNextRemove() { failures.remove = true; },
    failNextSignedUrl() { failures.createSignedUrl = true; },
    reset() { objects.clear(); calls.put.length = 0; calls.remove.length = 0; calls.createSignedUrl.length = 0; failures.put = false; failures.remove = false; failures.createSignedUrl = false; },
    objectExists(objectKey) { return objects.has(objectKey); },
    inspect(objectKey) { return objects.get(objectKey); },
    async put(objectKey, file) {
      calls.put.push({ objectKey, mimeType: file.mimetype, size: file.size });
      if (failures.put) { failures.put = false; throw new Error('fake put failure'); }
      objects.set(objectKey, { objectKey, mimeType: file.mimetype, size: file.size, checksum: crypto.createHash('sha256').update(file.buffer).digest('hex'), createdAt: new Date() });
      return { provider: 'fake', bucket: 'sms-v3-test-license-documents' };
    },
    async remove(objectKey) {
      calls.remove.push({ objectKey });
      if (failures.remove) { failures.remove = false; throw new Error('fake remove failure'); }
      objects.delete(objectKey);
    },
    async createSignedUrl(objectKey, expiresIn = 600) {
      calls.createSignedUrl.push({ objectKey, expiresIn });
      if (failures.createSignedUrl) { failures.createSignedUrl = false; throw new Error('fake signed URL failure'); }
      if (!objects.has(objectKey)) throw new Error('fake object missing');
      return `https://fake-storage.invalid/${objectKey.split('/').map(encodeURIComponent).join('/')}?expires=${expiresIn}`;
    }
  };
}

module.exports = { createFakeLicenseDocumentStorage };
