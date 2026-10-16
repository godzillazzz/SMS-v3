'use strict';
const { roleApiMatrix } = require('./role-matrix');

// Identifiers come ONLY from the reviewed, static authorization contract.
// Do not interpolate a runtime path, request URL, response body or account data.
function candidateCheckName(label) {
  return 'API_' + String(label || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
const API_CHECKS = Object.freeze([
  ...new Set(Object.values(roleApiMatrix).flatMap((routes) =>
    routes.map(([label]) => candidateCheckName(label)))),
  'API_DENY_NO_TOKEN',
  'API_DENY_INVALID_TOKEN'
]);
function apiCheckName(label) {
  const name = candidateCheckName(label);
  if (!API_CHECKS.includes(name)) throw new Error('UAT_API_CHECK_UNALLOWLISTED');
  return name;
}
function assertApiHttpStatus(actual, expected) {
  if (!Number.isInteger(actual) || actual < 100 || actual > 599
    || !Number.isInteger(expected) || expected < 100 || expected > 599) {
    throw new Error('UAT_API_STATUS_UNVERIFIED');
  }
  if (actual !== expected) {
    // HTTP status codes are low-risk; no URL, body, header or session is recorded.
    throw new Error('UAT_API_HTTP_MISMATCH_EXPECTED_' + expected + '_ACTUAL_' + actual);
  }
}
module.exports = { API_CHECKS, apiCheckName, assertApiHttpStatus };
