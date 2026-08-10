function technicalFailure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertExpectedStatus(actual, expected, code) {
  if (actual !== expected) throw technicalFailure(code);
}

function assertReadiness(payload) {
  if (!payload || payload.status !== 'ready') throw technicalFailure('READINESS_STATUS_INVALID');
  if (payload.database !== 'ok') throw technicalFailure('READINESS_DATABASE_NOT_OK');
}

function extractViteAssets(html) {
  if (typeof html !== 'string' || !/<html[\s>]/i.test(html)) throw technicalFailure('APPLICATION_HTML_INVALID');
  if (/_next\//i.test(html)) throw technicalFailure('UNEXPECTED_NEXT_ARTIFACT');
  const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/gi)].map((match) => match[1]);
  if (!assets.some((asset) => asset.endsWith('.js')) || !assets.some((asset) => asset.endsWith('.css'))) {
    throw technicalFailure('VITE_ASSETS_MISSING');
  }
  return [...new Set(assets)];
}

module.exports = { assertExpectedStatus, assertReadiness, extractViteAssets, technicalFailure };
