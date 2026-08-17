const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const G03_EMPLOYEE_FIELD_LABEL = 'พนักงาน (รหัส · ชื่อ · หน่วยงาน)';
const G03_NEW_ENTITLEMENT_WORDING = 'ตามสิทธิ์ที่กำหนด (วัน)';
const G03_OLD_ANNUAL_WORDING = 'ตามสิทธิ์ประจำปี (วัน)';

function g03EmployeeSelector(dialog) {
  const field = dialog.locator('label.field-group').filter({ hasText: G03_EMPLOYEE_FIELD_LABEL });
  return {
    field,
    label: field.locator(':scope > span'),
    control: field.locator(':scope > select')
  };
}

async function g03EntitlementWordingSnapshot(page) {
  const surface = page.locator('.leave-page');
  const labels = surface.locator('.leave-quota-card small');
  const texts = (await labels.allTextContents()).map((value) => String(value || '').trim());
  return {
    surface,
    newWordingPresent: texts.some((value) => value === G03_NEW_ENTITLEMENT_WORDING),
    oldWordingAbsent: !texts.some((value) => value === G03_OLD_ANNUAL_WORDING)
  };
}

const emptyMutationCounts = () => ({
  leaveQuotaPost: 0,
  leaveQuotaPut: 0,
  leaveQuotaLink: 0,
  leaveQuotaDelete: 0,
  employeeMutation: 0,
  leaveMutation: 0,
  scheduleMutation: 0,
  licenseMutation: 0,
  unexpectedBusinessWrites: 0
});

function safeApiPath(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

function classifyG03BusinessMutation(methodValue, pathValue) {
  const method = String(methodValue || '').toUpperCase();
  const path = String(pathValue || '');
  if (!MUTATING_METHODS.has(method) || !path.startsWith('/api/v1/')) return undefined;
  if (path.startsWith('/api/v1/auth/')) return undefined;

  if (path === '/api/v1/leave-quotas' && method === 'POST') return 'leaveQuotaPost';
  if (/^\/api\/v1\/leave-quotas\/[^/]+\/link$/.test(path)) return 'leaveQuotaLink';
  if (path.startsWith('/api/v1/leave-quotas/') && ['PUT', 'PATCH'].includes(method)) return 'leaveQuotaPut';
  if (path.startsWith('/api/v1/leave-quotas/') && method === 'DELETE') return 'leaveQuotaDelete';
  if (path === '/api/v1/leave-quotas' && method !== 'POST') return 'unexpectedBusinessWrites';

  if (path === '/api/v1/employees' || path.startsWith('/api/v1/employees/')) return 'employeeMutation';
  if (path.startsWith('/api/v1/leave')) return 'leaveMutation';
  if (
    path.startsWith('/api/v1/schedule')
    || path.startsWith('/api/v1/shifts')
    || path.startsWith('/api/v1/shift-types')
    || path.startsWith('/api/v1/scheduling-rules')
  ) return 'scheduleMutation';
  if (path.startsWith('/api/v1/licenses') || path.startsWith('/api/v1/license-documents')) return 'licenseMutation';

  return 'unexpectedBusinessWrites';
}

function summarizeSelectorOptions(optionRecords) {
  const candidates = (Array.isArray(optionRecords) ? optionRecords : [])
    .filter((option) => String(option?.value || '').trim())
    .map((option) => String(option?.label || ''));
  const parts = candidates.map((label) => label.split(' · ').map((value) => value.trim()));
  const allHavePart = (index) => candidates.length > 0 && parts.every((entry) => Boolean(entry[index]));
  return {
    selectorLoaded: true,
    candidateCount: candidates.length,
    codeRenderingPresent: allHavePart(0),
    nameRenderingPresent: allHavePart(1),
    departmentRenderingPresent: allHavePart(2)
  };
}

function legacyWarningExpectedFromQuotaPayload(payload) {
  const unmatchedLegacyCount = Math.max(0, Number(payload?.meta?.unmatchedLegacyCount || 0));
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const hasUnmatchedLegacyRow = rows.some((row) =>
    ['UNMATCHED', 'DUPLICATE_UNMATCHED'].includes(String(row?.matchStatus || ''))
  );
  return unmatchedLegacyCount > 0 || hasUnmatchedLegacyRow;
}

async function startG03MutationGuard(page) {
  const counts = emptyMutationCounts();
  const blockedBusinessWrites = [];
  const pattern = '**/api/v1/**';
  const handler = async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const path = safeApiPath(request.url());
    const classification = classifyG03BusinessMutation(method, path);
    if (!classification) return route.fallback();

    counts[classification] += 1;
    blockedBusinessWrites.push({ method, path, classification });
    await route.abort('blockedbyclient');
  };

  await page.route(pattern, handler);
  return {
    summary() {
      return {
        ...counts,
        blockedBusinessWrites: blockedBusinessWrites.slice(0, 20)
      };
    },
    assertClean() {
      const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
      if (total !== 0) {
        const error = new Error('G03_FOCUSED_AUTH_MUTATION_GUARD_FAILED');
        error.code = error.message;
        throw error;
      }
    },
    async stop() {
      if (!page.isClosed?.()) await page.unroute(pattern, handler);
    }
  };
}

async function runWithG03MutationGuard(page, testInfo, callback) {
  const guard = await startG03MutationGuard(page);
  let result;
  let callbackError;
  let guardError;
  try {
    result = await callback(guard);
  } catch (error) {
    callbackError = error;
  }
  try {
    guard.assertClean();
  } catch (error) {
    guardError = error;
  } finally {
    await testInfo.attach('g03-mutation-guard.json', {
      body: JSON.stringify(guard.summary()),
      contentType: 'application/json'
    });
    await guard.stop();
  }
  if (guardError) throw guardError;
  if (callbackError) throw callbackError;
  return result;
}

module.exports = {
  G03_EMPLOYEE_FIELD_LABEL,
  G03_NEW_ENTITLEMENT_WORDING,
  G03_OLD_ANNUAL_WORDING,
  classifyG03BusinessMutation,
  emptyMutationCounts,
  g03EmployeeSelector,
  g03EntitlementWordingSnapshot,
  legacyWarningExpectedFromQuotaPayload,
  runWithG03MutationGuard,
  safeApiPath,
  startG03MutationGuard,
  summarizeSelectorOptions
};
