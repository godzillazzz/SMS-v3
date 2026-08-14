const { test, expect } = require('../helpers/uat-test');
const { getUatConfig, isReportCenterDiagnostic } = require('../helpers/uat-config');
const { automationRequestOptions } = require('../helpers/technical-smoke');

test('V3 unauthenticated protected read routes return 401', async ({ request }) => {
  test.skip(isReportCenterDiagnostic(), 'The diagnostic scope excludes the complete auth-boundary suite.');
  const config = getUatConfig();
  for (const path of ['/api/v1/executive-report?year=2026&month=8', '/api/v1/system-settings', '/api/v1/users']) {
    const response = await request.get(path, automationRequestOptions({}, process.env, config.baseURL, `${config.baseURL}${path}`));
    expect(response.status(), `${path} must reject missing authentication.`).toBe(401);
  }
});
