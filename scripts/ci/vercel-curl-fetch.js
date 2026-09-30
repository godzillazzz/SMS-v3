'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function parseCurlHeaders(raw) {
  const blocks = String(raw || '').split(/\r?\n\r?\n/).filter((block) => /^HTTP\/\d(?:\.\d)?\s+\d{3}/i.test(block));
  const block = blocks.at(-1) || '';
  const headers = new Map();
  for (const line of block.split(/\r?\n/).slice(1)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }
  return headers;
}

function createVercelCurlFetch({ baseUrl, token, orgId, projectId, cliVersion, run = spawnSync }) {
  const deployment = new URL(baseUrl);
  if (deployment.protocol !== 'https:') throw new Error('protected Vercel runtime requires an HTTPS deployment URL');
  if (!/^team_[A-Za-z0-9]+$/.test(orgId || '')) throw new Error('protected Vercel runtime team identity is invalid');
  if (!/^prj_[A-Za-z0-9]+$/.test(projectId || '')) throw new Error('protected Vercel runtime project identity is invalid');
  if (!/^\d+\.\d+\.\d+$/.test(cliVersion || '')) throw new Error('protected Vercel runtime CLI version is invalid');

  return async (rawUrl, init = {}) => {
    const requested = new URL(rawUrl);
    if (requested.origin !== deployment.origin) throw new Error('protected runtime request escaped deployment origin');

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-runtime-'));
    const bodyFile = path.join(scratch, 'body.txt');
    const headersFile = path.join(scratch, 'headers.txt');
    try {
      const curlArgs = [
        '--silent', '--show-error', '--max-time', '30',
        '--dump-header', headersFile,
        '--output', bodyFile,
        '--write-out', '%{http_code}',
      ];
      const method = String(init.method || 'GET').toUpperCase();
      if (method !== 'GET') curlArgs.push('--request', method);
      const entries = init.headers instanceof Headers
        ? [...init.headers.entries()]
        : Object.entries(init.headers || {});
      for (const [name, value] of entries) {
        if (/[^!#$%&'*+.^_`|~0-9A-Za-z-]/.test(name) || /[\r\n]/.test(String(value))) {
          throw new Error('protected runtime request contains an invalid HTTP header');
        }
        curlArgs.push('--header', `${name}: ${value}`);
      }

      const result = run('npx', [
        '--yes', `vercel@${cliVersion}`, 'curl',
        `${requested.pathname}${requested.search}`,
        '--deployment', deployment.toString().replace(/\/$/, ''),
        ...curlArgs,
      ], {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        timeout: 45_000,
        env: {
          ...process.env,
          VERCEL_ORG_ID: orgId,
          VERCEL_PROJECT_ID: projectId,
          ...(token ? { VERCEL_TOKEN: token } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (result.error || result.status !== 0) {
        throw new Error(`protected Vercel request failed for ${requested.pathname}`);
      }
      const statusText = String(result.stdout || '').trim();
      if (!/^\d{3}$/.test(statusText)) {
        throw new Error(`protected Vercel request returned no HTTP status for ${requested.pathname}`);
      }
      const body = fs.readFileSync(bodyFile, 'utf8');
      return {
        status: Number(statusText),
        url: requested.toString(),
        headers: parseCurlHeaders(fs.readFileSync(headersFile, 'utf8')),
        text: async () => body,
        json: async () => JSON.parse(body),
      };
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  };
}

module.exports = { createVercelCurlFetch, parseCurlHeaders };
