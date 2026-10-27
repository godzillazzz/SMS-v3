import React, { useEffect, useRef, useState } from 'react';
import { fetchWithResilience } from './lib/request-resilience';

export type LeavePrintLedger = {
  available: boolean;
  bucket?: 'SICK' | 'PERSONAL' | 'VACATION';
  entitlementDays?: number;
  previouslyApprovedDays?: number;
  requestDays?: number;
  remainingBeforeDays?: number;
  remainingAfterDays?: number;
  unit?: 'วัน (ปฏิทิน)';
  message?: string;
};

export type LeavePrintRow = { id: string; status?: string } & Record<string, unknown>;

export const LEAVE_PRINT_LEDGER_READY_EVENT = 'smsv3:leave-print-ledger-ready';

export function bridgeLeavePrint(
  row: LeavePrintRow,
  ledger: LeavePrintLedger,
  onPrint: (row: LeavePrintRow) => void
) {
  onPrint(row);
  window.dispatchEvent(new CustomEvent(LEAVE_PRINT_LEDGER_READY_EVENT, { detail: { row, ledger } }));
}

const PRINT_ROLES = new Set(['ADMIN', 'MANAGER', 'SUPERVISOR']);

export function isPrintReadyLeaveLedger(ledger?: LeavePrintLedger | null): ledger is LeavePrintLedger {
  return Boolean(ledger?.available
    && [ledger.entitlementDays, ledger.previouslyApprovedDays, ledger.requestDays, ledger.remainingBeforeDays, ledger.remainingAfterDays]
      .every((value) => typeof value === 'number' && Number.isFinite(value))
    && ['SICK', 'PERSONAL', 'VACATION'].includes(String(ledger.bucket))
    && ledger.unit === 'วัน (ปฏิทิน)');
}

export async function getLeavePrintLedger(token: string, requestId: string): Promise<{ data: LeavePrintLedger }> {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';
  const response = await fetchWithResilience(`${apiBaseUrl}/leave-requests/${encodeURIComponent(requestId)}/print-ledger`, {
    method: 'GET',
    credentials: 'include',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error('Unable to load leave print ledger.');
  return response.json();
}

type LeavePrintLedgerPanelProps = {
  role?: string;
  row: LeavePrintRow;
  token?: string;
  onPrint(row: LeavePrintRow): void;
};

export function LeavePrintLedgerPanel(props: LeavePrintLedgerPanelProps) {
  if (!PRINT_ROLES.has(String(props.role || ''))) return null;
  return <LeavePrintLedgerButton key={`${props.token || ''}:${props.role || ''}:${props.row.id}:${props.row.status || ''}`} {...props} />;
}

function LeavePrintLedgerButton({ role, row, token, onPrint }: LeavePrintLedgerPanelProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'unavailable'>('idle');
  const pending = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const requestGeneration = ++generation.current;
    return () => {
      generation.current = requestGeneration + 1;
    };
  }, []);

  const loadAndPrint = async () => {
    if (!token || pending.current || row.status !== 'APPROVED') return;
    pending.current = true;
    const requestGeneration = generation.current;
    setState('loading');
    try {
      const response = await getLeavePrintLedger(token, row.id);
      if (requestGeneration !== generation.current) return;
      const ledger = response?.data as LeavePrintLedger | undefined;
      if (!isPrintReadyLeaveLedger(ledger)) {
        setState('unavailable');
        return;
      }
      setState('idle');
      bridgeLeavePrint(row, ledger, onPrint);
    } catch {
      if (requestGeneration === generation.current) setState('unavailable');
    } finally {
      if (requestGeneration === generation.current) pending.current = false;
    }
  };

  return <>
    <button type="button" className="btn-info leave-print-button" disabled={!token || state === 'loading'} onClick={() => { void loadAndPrint(); }}>
      {state === 'loading' ? 'กำลังตรวจสอบยอด…' : 'พิมพ์ A4'}
    </button>
    {state === 'unavailable' ? <small className="leave-print-ledger-unavailable" role="status">ไม่สามารถแสดงยอดคงเหลือได้ ข้อมูลโควตาหรือประวัติการลาไม่ครบถ้วน</small> : null}
  </>;
}
