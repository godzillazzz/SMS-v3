import { AttendanceOperationsPanel } from '../pages/attendance/AttendanceOperationsPanel';
import { SecuritySiteManagementPanel as SecuritySiteManagementCorePanel } from './SecuritySiteManagementCorePanel';

type Props = { token: string };

type TokenContext = { role: string; department?: string; readOnly: boolean };

function tokenContext(token: string): TokenContext {
  try {
    const payload = token.split('.')[1];
    if (!payload || typeof globalThis.atob !== 'function') return { role: '', readOnly: false };
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const parsed = JSON.parse(globalThis.atob(padded)) as { role?: unknown; department?: unknown; impersonatorSub?: unknown };
    return {
      role: String(parsed.role || '').trim().toUpperCase(),
      department: parsed.department == null ? undefined : String(parsed.department),
      readOnly: Boolean(parsed.impersonatorSub)
    };
  } catch {
    return { role: '', readOnly: false };
  }
}

export function SecuritySiteManagementPanel({ token }: Props) {
  const context = tokenContext(token);
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  return <>
    <AttendanceOperationsPanel token={token} role={context.role} department={context.department} readOnly={context.readOnly} online={online} />
    <SecuritySiteManagementCorePanel token={token} />
  </>;
}

export { tokenContext };
