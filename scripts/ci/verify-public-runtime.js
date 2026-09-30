'use strict';

const DEFAULT_LIMITS = Object.freeze({
  maxAssets: 128,
  maxConcurrentFetches: 4,
  maxDepth: 12,
  maxAssetBytes: 8 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  timeoutMs: 20_000,
});

function safePath(url) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search ? '?<query>' : ''}`;
}

function resolveRuntimeAsset(reference, currentUrl, origin) {
  let parsed;
  try {
    parsed = new URL(reference.replaceAll('\\/', '/'), currentUrl);
  } catch {
    return { kind: 'malformed' };
  }

  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.origin !== origin ||
    parsed.username ||
    parsed.password
  ) {
    return { kind: 'external' };
  }

  if (!/\.js$/i.test(parsed.pathname) || !parsed.pathname.startsWith('/assets/')) {
    return { kind: 'non-js' };
  }

  parsed.hash = '';
  return { kind: 'asset', url: parsed.toString() };
}

function extractJavaScriptReferences(source) {
  const references = new Set();
  const patterns = [
    /\bimport\s*\(\s*(['"`])([^'"`\r\n]{1,2048})\1\s*\)/g,
    /\b(?:import|export)\s+[^;\r\n]{0,4096}?\bfrom\s*(['"`])([^'"`\r\n]{1,2048})\1/g,
    /\bimport\s*(['"`])([^'"`\r\n]{1,2048})\1/g,
    /\bnew\s+URL\(\s*(['"`])([^'"`\r\n]{1,2048})\1\s*,\s*import\.meta\.url\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const reference = match[2];
      if (/\.js(?:[?#][^\s]*)?$/i.test(reference)) references.add(reference);
    }
  }
  return [...references];
}

function findEntryScript(html, baseUrl) {
  const base = new URL(baseUrl);
  const scripts = [];
  const scriptPattern = /<script\b([^>]*)>/gi;
  let match;
  while ((match = scriptPattern.exec(html)) !== null) {
    const attrs = match[1];
    const src = attrs.match(/\bsrc\s*=\s*(["'])([^"']+)\1/i)?.[2];
    if (!src) continue;
    const isModule = /\btype\s*=\s*(["'])module\1/i.test(attrs);
    const resolved = resolveRuntimeAsset(src, base.toString(), base.origin);
    if (resolved.kind === 'asset') scripts.push({ ...resolved, isModule });
  }

  const entry = scripts.find((script) => script.isModule) || scripts[0];
  if (!entry) throw new Error('main frontend JavaScript entry not found in HTML');
  return entry.url;
}

function getHeader(response, name) {
  if (!response.headers) return '';
  if (typeof response.headers.get === 'function') return response.headers.get(name) || '';
  const entries = Object.entries(response.headers);
  return entries.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] || '';
}

function isHtmlDocument(text) {
  return /^\s*(?:<!doctype\s+html|<html\b)/i.test(text);
}

async function verifyPublicRuntime({
  baseUrl,
  html,
  sentinels,
  fetchImpl = globalThis.fetch,
  limits = {},
  onLog = (line) => process.stdout.write(`${line}\n`),
}) {
  if (typeof fetchImpl !== 'function') throw new Error('runtime verifier requires a fetch implementation');
  if (!Array.isArray(sentinels) || sentinels.length === 0 || sentinels.some((value) => typeof value !== 'string' || !value)) {
    throw new Error('runtime verifier requires non-empty sentinel strings');
  }

  const activeLimits = { ...DEFAULT_LIMITS, ...limits };
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new Error('runtime base URL must use HTTP or HTTPS');
  base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
  base.search = '';
  base.hash = '';

  const entryUrl = findEntryScript(html, base.toString());
  const queue = [{ url: entryUrl, depth: 0 }];
  const scheduled = new Set([entryUrl]);
  const assets = [];
  const found = new Map();
  let totalBytes = 0;

  if (!Number.isInteger(activeLimits.maxAssets) || activeLimits.maxAssets < 1) throw new Error('runtime asset max count is invalid');
  if (!Number.isInteger(activeLimits.maxConcurrentFetches) || activeLimits.maxConcurrentFetches < 1) throw new Error('runtime asset concurrency limit is invalid');
  if (!Number.isInteger(activeLimits.maxDepth) || activeLimits.maxDepth < 0) throw new Error('runtime asset max depth is invalid');

  async function fetchRuntimeAsset(item) {
    let response;
    try {
      response = await fetchImpl(item.url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(activeLimits.timeoutMs),
      });
    } catch {
      throw new Error(`runtime asset fetch failed: ${safePath(item.url)}`);
    }

    let actualUrl;
    try {
      actualUrl = new URL(response.url || item.url);
    } catch {
      throw new Error(`runtime asset returned malformed URL: ${safePath(item.url)}`);
    }
    if (actualUrl.origin !== base.origin || !actualUrl.pathname.startsWith('/assets/') || !/\.js$/i.test(actualUrl.pathname)) {
      throw new Error(`runtime asset escaped same-origin JavaScript scope: ${safePath(item.url)}`);
    }
    if (response.status !== 200) {
      throw new Error(`runtime asset fetch returned HTTP ${response.status}: ${safePath(item.url)}`);
    }

    let source;
    try {
      source = await response.text();
    } catch {
      throw new Error(`runtime asset body could not be read: ${safePath(item.url)}`);
    }
    const bytes = Buffer.byteLength(source, 'utf8');
    if (bytes > activeLimits.maxAssetBytes) {
      throw new Error(`runtime asset exceeded max size ${activeLimits.maxAssetBytes}: ${safePath(item.url)}`);
    }
    if (isHtmlDocument(source)) {
      throw new Error(`runtime asset returned HTML instead of JavaScript: ${safePath(item.url)}`);
    }
    const contentType = getHeader(response, 'content-type').split(';', 1)[0].trim().toLowerCase();
    if (!contentType || !/(?:javascript|ecmascript|x-javascript)$/.test(contentType)) {
      throw new Error(`runtime asset returned non-JavaScript content type: ${safePath(item.url)}`);
    }
    return { item, source, bytes, assetPath: safePath(item.url) };
  }

  while (queue.length > 0) {
    const batch = queue.splice(0, activeLimits.maxConcurrentFetches);
    const fetched = await Promise.all(batch.map(fetchRuntimeAsset));

    for (const result of fetched) {
      totalBytes += result.bytes;
      if (totalBytes > activeLimits.maxTotalBytes) {
        throw new Error(`runtime assets exceeded max total size ${activeLimits.maxTotalBytes}`);
      }

      assets.push({ path: result.assetPath, bytes: result.bytes });
      for (const sentinel of sentinels) {
        if (!found.has(sentinel) && result.source.includes(sentinel)) {
          found.set(sentinel, result.assetPath);
          onLog(`SENTINEL_FOUND=${JSON.stringify(sentinel)} ASSET=${result.assetPath}`);
        }
      }

      for (const reference of extractJavaScriptReferences(result.source)) {
        const resolved = resolveRuntimeAsset(reference, result.item.url, base.origin);
        if (resolved.kind !== 'asset' || scheduled.has(resolved.url)) continue;
        if (result.item.depth + 1 > activeLimits.maxDepth) {
          throw new Error(`runtime asset traversal exceeded max depth ${activeLimits.maxDepth}`);
        }
        if (scheduled.size >= activeLimits.maxAssets) {
          throw new Error(`runtime asset traversal exceeded max asset count ${activeLimits.maxAssets}`);
        }
        scheduled.add(resolved.url);
        queue.push({ url: resolved.url, depth: result.item.depth + 1 });
      }
    }
  }

  const missing = sentinels.filter((sentinel) => !found.has(sentinel));
  if (missing.length) throw new Error(`missing runtime sentinels: ${missing.join(', ')}`);
  return {
    entryUrl,
    assets,
    totalBytes,
    sentinels: Object.fromEntries(found),
  };
}

module.exports = {
  DEFAULT_LIMITS,
  extractJavaScriptReferences,
  findEntryScript,
  resolveRuntimeAsset,
  verifyPublicRuntime,
};
