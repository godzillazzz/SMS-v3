import type { ReactNode } from 'react';
import {
  DataTableSkeletonCards,
  DataTableSkeletonRows,
  DataTableState,
  ResponsiveDataTable
} from './ResponsiveDataTable';

export type RuleCheckingRow = Record<string, unknown>;

type RuleResult = RuleCheckingRow & {
  ruleId?: unknown;
  passed?: unknown;
  summary?: unknown;
};

type RuleCheckingDataSurfacesProps = {
  rules: RuleCheckingRow[];
  results: RuleResult[];
  violations: RuleCheckingRow[];
  loading: boolean;
  canManage: boolean;
  onAction(row: RuleCheckingRow, action: 'edit' | 'toggle'): void;
};

const display = (value: unknown, fallback = '—') => {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
};

const resultSummary = (result: RuleResult | undefined) => display(result?.summary, 'รอตรวจ');

function RuleStatus({ rule, result }: { rule: RuleCheckingRow; result?: RuleResult }) {
  const enabled = Boolean(rule.enabled);
  const passed = Boolean(result?.passed);
  const className = !enabled ? 'status-badge--neutral' : passed ? 'status-badge--success' : 'status-badge--warning';
  return <span className={`status-badge ${className}`}>{!enabled ? 'ปิดใช้' : resultSummary(result)}</span>;
}

function RuleActions({ rule, onAction }: { rule: RuleCheckingRow; onAction(row: RuleCheckingRow, action: 'edit' | 'toggle'): void }) {
  return <div className="row-actions data-row-actions rule-checking-row-actions">
    <button type="button" className="btn-info-outline data-row-primary-action" onClick={() => onAction(rule, 'edit')}>แก้ไข</button>
    <button type="button" className="btn-neutral" onClick={() => onAction(rule, 'toggle')}>{rule.enabled ? 'ปิดใช้' : 'เปิดใช้'}</button>
  </div>;
}

function RuleCards({ rules, resultById, canManage, loading, onAction }: { rules: RuleCheckingRow[]; resultById: Map<string, RuleResult>; canManage: boolean; loading: boolean; onAction(row: RuleCheckingRow, action: 'edit' | 'toggle'): void }) {
  if (loading) return <div className="rule-checking-mobile-list"><DataTableSkeletonCards count={3} cardClassName="rule-checking-mobile-card" /></div>;
  if (!rules.length) return <DataTableState variant="empty" title="ยังไม่มีข้อมูลกฎ" description="ยังไม่มี rule definition ในขอบเขตนี้" />;
  return <div className="rule-checking-mobile-list">{rules.map((rule, index) => {
    const result = resultById.get(String(rule.ruleId));
    return <article className="rule-checking-mobile-card data-mobile-card" key={`${display(rule.id, `rule-${index}`)}-mobile`}>
      <header><div><small>Rule ID</small><code>{display(rule.ruleId)}</code></div><RuleStatus rule={rule} result={result} /></header>
      <h3>{display(rule.name)}</h3>
      <dl>
        <div><dt>ค่า</dt><dd>{display(rule.value)}</dd></div>
        <div><dt>หน่วย</dt><dd>{display(rule.unit)}</dd></div>
      </dl>
      {canManage && <RuleActions rule={rule} onAction={onAction} />}
    </article>;
  })}</div>;
}

function ViolationCards({ violations, loading }: { violations: RuleCheckingRow[]; loading: boolean }) {
  if (loading) return <div className="rule-checking-mobile-list"><DataTableSkeletonCards count={3} cardClassName="rule-checking-mobile-card" /></div>;
  if (!violations.length) return <DataTableState variant="empty" title="ไม่พบรายการขัดกฎในเดือนนี้" description="ผ่านทุกกฎที่เปิดใช้งาน" />;
  return <div className="rule-checking-mobile-list">{violations.slice(0, 500).map((item, index) => <article className="rule-checking-mobile-card data-mobile-card" key={`${display(item.ruleId)}-${index}-violation`}>
    <header><div><small>Rule</small><code>{display(item.ruleId)}</code>{item.ruleName ? <small>{display(item.ruleName)}</small> : null}</div><span className={`status-badge ${item.severity === 'error' ? 'status-badge--danger' : 'status-badge--warning'}`}>{display(item.severity)}</span></header>
    <h3>{display(item.title)}</h3>
    <p>{display(item.description)}</p>
  </article>)}</div>;
}

function RuleTable({ rules, resultById, canManage, loading, onAction }: { rules: RuleCheckingRow[]; resultById: Map<string, RuleResult>; canManage: boolean; loading: boolean; onAction(row: RuleCheckingRow, action: 'edit' | 'toggle'): void }) {
  const columnCount = canManage ? 6 : 5;
  const desktop = <div className="table-card rule-checking-desktop-table"><div className="data-table-scroll"><table className="data-surface-table" aria-label="ผลตรวจสอบกฎการทำงาน"><thead><tr><th scope="col">Rule ID</th><th scope="col">ชื่อกฎ</th><th scope="col">ค่า</th><th scope="col">หน่วย</th><th scope="col">ผลตรวจ</th>{canManage && <th scope="col">จัดการ</th>}</tr></thead><tbody>
    {loading ? <DataTableSkeletonRows columnCount={columnCount} rowCount={5} /> : rules.length ? rules.map((rule, index) => {
      const result = resultById.get(String(rule.ruleId));
      return <tr key={`${display(rule.id, `rule-${index}`)}-desktop`}>
        <td><code>{display(rule.ruleId)}</code></td>
        <td className="employee-name">{display(rule.name)}</td>
        <td>{display(rule.value)}</td>
        <td>{display(rule.unit)}</td>
        <td><RuleStatus rule={rule} result={result} /></td>
        {canManage && <td><RuleActions rule={rule} onAction={onAction} /></td>}
      </tr>;
    }) : <tr><td colSpan={columnCount} className="data-table-empty-cell"><DataTableState variant="empty" title="ยังไม่มีข้อมูลกฎ" description="ยังไม่มี rule definition ในขอบเขตนี้" announce={false} /></td></tr>}
  </tbody></table></div></div>;
  const mobile = <RuleCards rules={rules} resultById={resultById} canManage={canManage} loading={loading} onAction={onAction} />;
  return <ResponsiveDataTable ariaLabel="ผลตรวจสอบกฎการทำงาน" loading={loading} loadingLabel="กำลังตรวจสอบกฎ…" hasRows={rules.length > 0} className="rule-checking-responsive-table" desktop={desktop} mobile={mobile} />;
}

function ViolationTable({ violations, loading }: { violations: RuleCheckingRow[]; loading: boolean }) {
  const desktop = <div className="table-card rule-checking-desktop-table"><div className="data-table-scroll"><table className="data-surface-table" aria-label="รายการที่ขัดกฎ"><thead><tr><th scope="col">Rule</th><th scope="col">รายการ</th><th scope="col">รายละเอียด</th><th scope="col">ระดับ</th></tr></thead><tbody>
    {loading ? <DataTableSkeletonRows columnCount={4} rowCount={5} /> : violations.length ? violations.slice(0, 500).map((item, index) => <tr key={`${display(item.ruleId)}-${index}`}>
      <td><code>{display(item.ruleId)}</code>{item.ruleName ? <small className="cell-note">{display(item.ruleName)}</small> : null}</td>
      <td className="employee-name">{display(item.title)}</td>
      <td className="rule-checking-description">{display(item.description)}</td>
      <td><span className={`status-badge ${item.severity === 'error' ? 'status-badge--danger' : 'status-badge--warning'}`}>{display(item.severity)}</span></td>
    </tr>) : <tr><td colSpan={4} className="data-table-empty-cell"><DataTableState variant="empty" title="ไม่พบรายการขัดกฎในเดือนนี้" description="ผ่านทุกกฎที่เปิดใช้งาน" announce={false} /></td></tr>}
  </tbody></table></div></div>;
  const mobile = <ViolationCards violations={violations} loading={loading} />;
  return <ResponsiveDataTable ariaLabel="รายการที่ขัดกฎ" loading={loading} loadingLabel="กำลังอ่านรายการที่ขัดกฎ…" hasRows={violations.length > 0} className="rule-checking-violations-responsive-table" desktop={desktop} mobile={mobile} />;
}

export function RuleCheckingDataSurfaces({ rules, results, violations, loading, canManage, onAction }: RuleCheckingDataSurfacesProps) {
  const resultById = new Map<string, RuleResult>();
  results.forEach((result) => {
    const resultId = String(result.id ?? '').trim();
    const ruleId = String(result.ruleId ?? '').trim();
    if (resultId) resultById.set(resultId, result);
    if (ruleId) resultById.set(ruleId, result);
  });
  const violationsHeading: ReactNode = <div className="section-title"><div><h2>รายการที่ต้องแก้ไข</h2><p>{violations.length ? `พบ ${violations.length} รายการ` : 'ผ่านทุกกฎที่เปิดใช้งาน'}</p></div></div>;
  return <>
    <RuleTable rules={rules} resultById={resultById} canManage={canManage} loading={loading} onAction={onAction} />
    {violationsHeading}
    <ViolationTable violations={violations} loading={loading} />
  </>;
}
