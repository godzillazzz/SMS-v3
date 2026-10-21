'use strict';

const HttpError = require('../utils/http-error');
const { createS3ObjectStorage } = require('./object-storage-provider');

function providerName(environment = process.env) {
  return String(environment.STORAGE_PROVIDER || 'supabase').trim().toLowerCase();
}

function selectStorage({ environment = process.env, supabaseFactory, s3Factory = createS3ObjectStorage, client } = {}) {
  const provider = providerName(environment);
  if (provider === 'supabase') return supabaseFactory();
  if (provider !== 's3') throw new HttpError(503, 'Object storage provider is unavailable.', { code: 'STORAGE_PROVIDER_INVALID' });
  if (environment.NODE_ENV !== 'test') throw new HttpError(503, 'S3 storage is not wired into application services; WIRE-02 is required.', { code: 'STORAGE_PROVIDER_NOT_WIRED' });
  return s3Factory({ environment, client });
}

module.exports = { providerName, selectStorage };
