import { ApiRequestError, normalizeRequestId } from './api';

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export type AutoSchedulePatternStep = {
  phaseCode: string;
  shiftCode: string;
  label: string;
};

export type AutoSchedulePattern = {
  id: string;
  code: string;
  name: string;
  mode: 'WEEKLY' | 'CYCLE';
  steps: AutoSchedulePatternStep[];
  isActive: boolean;
  isSystem: boolean;
  targetGroup: 'SUPERVISOR' | 'GENERAL' | 'MANUAL';
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
};

export type CreateAutoSchedulePatternInput = {
  code: string;
  name: string;
  mode: AutoSchedulePattern['mode'];
  steps: AutoSchedulePatternStep[];
  isActive?: boolean;
  targetGroup?: 'MANUAL';
  sortOrder?: number;
};

export type UpdateAutoSchedulePatternInput = Partial<Pick<AutoSchedulePattern, 'code' | 'name' | 'mode' | 'steps' | 'isActive' | 'targetGroup' | 'sortOrder'>>;

function responseRequestId(response: Response, payload?: unknown) {
  const headerRequestId = normalizeRequestId(response.headers?.get?.('x-request-id'));
  if (headerRequestId) return headerRequestId;
  if (payload && typeof payload === 'object' && 'requestId' in payload) {
    return normalizeRequestId((payload as { requestId?: unknown }).requestId);
  }
  return undefined;
}

async function callPatternApi(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...(init.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiRequestError(
      payload?.error || 'Auto Schedule Pattern operation failed',
      response.status,
      responseRequestId(response, payload),
      payload?.details
    );
  }
  return payload;
}

export async function getAutoSchedulePatterns(token: string, options: { includeInactive?: boolean } = {}) {
  return callPatternApi(`/auto-schedule-patterns${options.includeInactive ? '?includeInactive=true' : ''}`, token);
}

export async function createAutoSchedulePattern(token: string, input: CreateAutoSchedulePatternInput) {
  return callPatternApi('/auto-schedule-patterns', token, { method: 'POST', body: JSON.stringify(input) });
}

export async function updateAutoSchedulePattern(token: string, id: string, input: UpdateAutoSchedulePatternInput) {
  return callPatternApi(`/auto-schedule-patterns/${encodeURIComponent(id)}`, token, { method: 'PUT', body: JSON.stringify(input) });
}

export function describePattern(pattern: Pick<AutoSchedulePattern, 'mode' | 'steps'>) {
  const sequence = pattern.steps.map((step) => step.shiftCode);
  if (pattern.mode === 'WEEKLY') return `จ.-อา.: ${sequence.join(' / ')}`;
  return sequence.join(' / ');
}
