process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const otpSource = fs.readFileSync('src/services/email-otp.service.js', 'utf8');
const reviewSource = fs.readFileSync('src/services/registration-request.service.js', 'utf8');
const authRoutes = fs.readFileSync('src/routes/auth.routes.js', 'utf8');

test('G04.1 public registration/OTP duplicate guard never uses employeeCode as applicant identity', () => {
  assert.equal(otpSource.includes('employeeCode'), false);
  assert.equal(authRoutes.includes('employeeCode'), false);
  assert.equal(authRoutes.includes('available-employees'), false);
});

test('private reviewer candidate search does not search or rank by employeeCode; authoritative Match still uses Employee.id', () => {
  const search = reviewSource.slice(reviewSource.indexOf('async function searchCandidates'), reviewSource.indexOf('async function match'));
  assert.equal(/employeeCode\s*:\s*\{\s*contains/.test(search), false);
  assert.equal(/orderBy:\s*\[\{\s*employeeCode/.test(search), false);
  const match = reviewSource.slice(reviewSource.indexOf('async function match'), reviewSource.indexOf('async function approve'));
  assert.match(match, /where:\s*\{\s*id:\s*employeeId/);
  assert.match(match, /matchedEmployeeId:\s*employee\.id/);
});
