/* Thai presentation of /rule-checks violations (audit S-01 / S-04). Reads only fields the API already returns. */
export type RuleViolation = { ruleId?: unknown; ruleName?: unknown; title?: unknown; description?: unknown; severity?: unknown };

export type RuleViolationView = {
  key: string;
  ruleId: string;
  severity: 'error' | 'warning';
  severityLabel: string;
  title: string;
  detail?: string;
  date?: string;
};

const DATE = /(\d{4}-\d{2}-\d{2})/;

export const thaiShortDate = (iso: string) => {
  const value = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(value.getTime())) return iso;
  return new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(value);
};

export function describeRuleViolation(item: RuleViolation, index = 0): RuleViolationView {
  const ruleId = String(item.ruleId || '').trim();
  const rawTitle = String(item.title || '');
  const rawDescription = String(item.description || '');
  const severity = item.severity === 'error' ? 'error' : 'warning';
  const date = DATE.exec(rawTitle)?.[1];
  const on = date ? ` · ${thaiShortDate(date)}` : '';
  let title = rawTitle || String(item.ruleName || ruleId || 'รายการขัดกฎ');
  let detail: string | undefined;

  if (ruleId === 'RULE001') {
    const hours = /\((\d+(?:\.\d+)?)h\s*>\s*(\d+(?:\.\d+)?)h\)/.exec(rawTitle);
    title = hours ? `ชั่วโมงทำงานต่อสัปดาห์เกิน (${hours[1]} > ${hours[2]} ชม.)` : 'ชั่วโมงทำงานต่อสัปดาห์เกิน';
    const match = /^Employee (.+) exceeded weekly hours limit in (.+)\.$/.exec(rawDescription);
    detail = match ? `${match[1]} · สัปดาห์ ${match[2]}` : undefined;
  } else if (ruleId === 'RULE006' && /^No Supervisor/i.test(rawTitle)) {
    title = `ไม่มีหัวหน้างานเข้ากะ${on}`;
  } else if (ruleId === 'RULE006') {
    title = `หัวหน้างานเข้ากะวันอาทิตย์${on}`;
  } else if (ruleId === 'RULE005') {
    title = `มีกะทับวันลาที่อนุมัติแล้ว${on}`;
  } else if (ruleId === 'LICENSE') {
    title = `จัดกะให้คนที่ใบอนุญาตไม่ผ่าน${on}`;
  }

  return {
    key: `${ruleId || 'rule'}-${date || ''}-${index}`,
    ruleId,
    severity,
    severityLabel: severity === 'error' ? 'ขัดกฎ' : 'ควรตรวจ',
    title,
    detail,
    date
  };
}
