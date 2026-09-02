const HISTORICAL_DOCUMENT_STATUSES = ['APPROVED', 'SUPERSEDED', 'EXPIRED'];
const ADMIN_BLOCKED_LICENSE_STATUSES = new Set(['suspended', 'revoked', 'inactive']);

const normalizedStatus = (value) => String(value || '').trim().toLowerCase();
const activeLicense = (license) => ['active', 'valid'].includes(normalizedStatus(license?.status));
const workDate = (value) => new Date(Date.UTC(new Date(value).getUTCFullYear(), new Date(value).getUTCMonth(), new Date(value).getUTCDate()));

function licenseStateForWorkDate(records, value) {
  const date = workDate(value);
  const active = (records || []).filter(activeLicense);
  const valid = active.find((license) => license.issueDate && license.expiryDate && workDate(license.issueDate) <= date && workDate(license.expiryDate) >= date);
  if (valid) return { valid: true, status: 'VALID', expiryDate: valid.expiryDate, reason: null };
  const latest = [...active].sort((left, right) => new Date(right.expiryDate || 0) - new Date(left.expiryDate || 0))[0] || (records || [])[0];
  return { valid: false, status: latest ? (active.length ? 'EXPIRED' : 'INVALID') : 'MISSING', expiryDate: latest?.expiryDate || null, reason: latest ? 'ใบอนุญาตไม่มีผลในวันที่จัดกะ' : 'ไม่พบข้อมูลใบอนุญาต' };
}

function historicalDocumentAuthorityRecord(document, licenseById) {
  if (!document || !HISTORICAL_DOCUMENT_STATUSES.includes(String(document.status || '').toUpperCase())) return null;
  if (!document.proposedStartDate || !document.proposedExpiryDate) return null;
  const master = licenseById.get(document.licenseId);
  const masterStatus = normalizedStatus(master?.status);
  return { employeeId: document.employeeId || master?.employeeId || null, licenseId: document.licenseId, status: ADMIN_BLOCKED_LICENSE_STATUSES.has(masterStatus) ? master?.status : 'Active', issueDate: document.proposedStartDate, expiryDate: document.proposedExpiryDate, authoritySource: 'APPROVED_DOCUMENT_HISTORY', documentStatus: document.status };
}

function buildLicenseAuthorityByEmployee(licenses = [], documents = []) {
  const byEmployee = new Map();
  const licenseById = new Map((licenses || []).map((license) => [license.id, license]));
  const append = (record) => { if (!record?.employeeId) return; const rows = byEmployee.get(record.employeeId) || []; rows.push(record); byEmployee.set(record.employeeId, rows); };
  for (const license of licenses || []) append(license);
  for (const document of documents || []) append(historicalDocumentAuthorityRecord(document, licenseById));
  return byEmployee;
}

async function loadLicenseAuthorityByEmployee(client, employeeIds = null) {
  const ids = Array.isArray(employeeIds) ? [...new Set(employeeIds.filter(Boolean))] : null;
  if (ids && ids.length === 0) return new Map();
  const employeeWhere = ids ? { employeeId: { in: ids } } : {};
  const [licenses, documents] = await Promise.all([
    client.employeeLicense.findMany({ where: employeeWhere, select: { id: true, employeeId: true, status: true, issueDate: true, expiryDate: true } }),
    client.employeeLicenseDocument?.findMany
      ? client.employeeLicenseDocument.findMany({ where: { ...employeeWhere, status: { in: HISTORICAL_DOCUMENT_STATUSES } }, select: { employeeId: true, licenseId: true, status: true, proposedStartDate: true, proposedExpiryDate: true } })
      : Promise.resolve([])
  ]);
  return buildLicenseAuthorityByEmployee(licenses, documents);
}

module.exports = { HISTORICAL_DOCUMENT_STATUSES, activeLicense, licenseStateForWorkDate, workDate, historicalDocumentAuthorityRecord, buildLicenseAuthorityByEmployee, loadLicenseAuthorityByEmployee };
