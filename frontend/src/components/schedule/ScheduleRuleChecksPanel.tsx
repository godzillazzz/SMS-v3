import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { safeUserErrorMessage } from '../../request-error';
import { describeRuleViolation, thaiShortDate, type RuleViolation } from './schedule-rule-text';
import './schedule-rule-panel.css';

type Props = {
  token: string;
  month: string;
  monthLabel: string;
  /** Changes after saves so the check re-runs on the saved schedule. */
  refreshKey?: unknown;
  focusedDate?: string;
  onFocusDate(date: string): void;
};

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; violations: RuleViolation[]; checkedAt: Date };

const VISIBLE = 30;

/**
 * Rule results next to the monthly roster (audit S-01): the same GET /rule-checks the Rules page uses,
 * so nobody has to leave the schedule to see what breaks a rule. Read-only; no new API.
 */
export function ScheduleRuleChecksPanel({ token, month, monthLabel, refreshKey, focusedDate, onFocusDate }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [manual, setManual] = useState(0);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    api.ruleChecks(token, month)
      .then((result) => {
        if (!active) return;
        const data = (result?.data || {}) as { violations?: unknown };
        setState({ status: 'ready', violations: Array.isArray(data.violations) ? data.violations as RuleViolation[] : [], checkedAt: new Date() });
      })
      .catch((reason) => { if (active) setState({ status: 'error', message: safeUserErrorMessage(reason instanceof Error ? reason.message : reason, 'ตรวจกฎไม่สำเร็จ') }); });
    return () => { active = false; };
  }, [token, month, refreshKey, manual]);

  const views = useMemo(() => state.status === 'ready'
    ? state.violations.map(describeRuleViolation).sort((a, b) => (a.severity === b.severity ? (a.date || '').localeCompare(b.date || '') : a.severity === 'error' ? -1 : 1))
    : [], [state]);
  const errors = views.filter((view) => view.severity === 'error').length;
  const warnings = views.length - errors;
  const shown = showAll ? views : views.slice(0, VISIBLE);

  return (
    <details className="schedule-rule-panel" open={state.status !== 'ready' || views.length > 0}>
      <summary>
        <span className="schedule-rule-panel__title">ผลตรวจกฎ · {monthLabel}</span>
        <span className="schedule-rule-panel__counts" aria-live="polite">
          {state.status === 'loading' && 'กำลังตรวจ…'}
          {state.status === 'error' && 'ตรวจไม่สำเร็จ'}
          {state.status === 'ready' && (views.length
            ? <>{errors > 0 && <b className="is-error">ขัดกฎ {errors}</b>}{warnings > 0 && <b className="is-warning">ควรตรวจ {warnings}</b>}</>
            : <b className="is-ok">ผ่านทุกกฎที่เปิดใช้งาน</b>)}
        </span>
      </summary>
      <div className="schedule-rule-panel__body">
        <div className="schedule-rule-panel__meta">
          <span>{state.status === 'ready' ? `ตรวจจากตารางที่บันทึกแล้ว · ${new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit' }).format(state.checkedAt)} น.` : 'ตรวจจากตารางที่บันทึกแล้ว ฉบับร่างยังไม่ถูกนับ'}</span>
          <button type="button" onClick={() => setManual((value) => value + 1)} disabled={state.status === 'loading'}>ตรวจอีกครั้ง</button>
        </div>
        {state.status === 'error' && <p className="schedule-rule-panel__error" role="alert">{state.message}</p>}
        {state.status === 'ready' && views.length > 0 && (
          <ul className="schedule-rule-panel__list">
            {shown.map((view) => (
              <li key={view.key} className={view.date && view.date === focusedDate ? 'is-focused' : undefined}>
                <span className={`schedule-rule-panel__chip is-${view.severity}`}>{view.severityLabel}</span>
                <span className="schedule-rule-panel__copy"><strong>{view.title}</strong>{view.detail && <small>{view.detail}</small>}</span>
                {view.date && <button type="button" onClick={() => onFocusDate(view.date!)} aria-label={`ไปที่วัน ${thaiShortDate(view.date)} ในตาราง`}>ไปที่วัน</button>}
              </li>
            ))}
          </ul>
        )}
        {state.status === 'ready' && views.length > VISIBLE && (
          <button type="button" className="schedule-rule-panel__more" onClick={() => setShowAll((value) => !value)}>{showAll ? 'แสดงน้อยลง' : `แสดงทั้งหมด ${views.length} รายการ`}</button>
        )}
      </div>
    </details>
  );
}
