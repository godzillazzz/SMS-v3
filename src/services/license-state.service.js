const activeLicense = (license) => ['active', 'valid'].includes(String(license?.status || '').trim().toLowerCase());
const workDate = (value) => new Date(Date.UTC(new Date(value).getUTCFullYear(), new Date(value).getUTCMonth(), new Date(value).getUTCDate()));

function licenseStateForWorkDate(records, value) {
  const date = workDate(value);
  const active = (records || []).filter(activeLicense);
  const valid = active.find((license) => license.issueDate && license.expiryDate && workDate(license.issueDate) <= date && workDate(license.expiryDate) >= date);
  if (valid) return { valid: true, status: 'VALID', expiryDate: valid.expiryDate, reason: null };
  const latest = [...active].sort((left, right) => new Date(right.expiryDate || 0) - new Date(left.expiryDate || 0))[0] || (records || [])[0];
  return {
    valid: false,
    status: latest ? (active.length ? 'EXPIRED' : 'INVALID') : 'MISSING',
    expiryDate: latest?.expiryDate || null,
    reason: latest ? 'ใบอนุญาตไม่มีผลในวันที่จัดกะ' : 'ไม่พบข้อมูลใบอนุญาต'
  };
}

module.exports = { activeLicense, licenseStateForWorkDate, workDate };
