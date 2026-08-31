import { ApiRequestError, normalizeRequestId } from './api';

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export type RetentionPolicy = {
  operationalUsageMonths: number;
  attendanceRawMonths: number;
  patrolRawMonths: number;
  timezone: 'Asia/Bangkok';
};

export type RetentionImpact = {
  adapterStatus: 'ACTIVE' | 'NOT_AVAILABLE' | 'FAILED';
  cutoff: string;
  eligible?: number;
  totalCandidates?: number;
  blockedUncertified?: number;
  protectedByCorrection?: number;
  blockedMonths?: Array<{ month: string; count: number }>;
  reason?: string;
};

export type RetentionPreview = {
  current: RetentionPolicy;
  proposed: RetentionPolicy;
  reductions: Record<string, boolean>;
  reduction: boolean;
  cleanupDelayHours: number;
  timezone: string;
  impacts: {
    OPERATIONAL_USAGE: RetentionImpact;
    ATTENDANCE_RAW: RetentionImpact;
    PATROL_RAW: RetentionImpact;
  };
  protectedInvariants: string[];
  previewDigest: string;
};

export type RetentionPolicyChange = {
  id: string;
  status: 'SCHEDULED' | 'APPLIED' | 'CANCELLED';
  beforePolicy: RetentionPolicy;
  proposedPolicy: RetentionPolicy;
  reason: string;
  requestedAt: string;
  effectiveAt: string;
  appliedAt?: string | null;
  cancelledAt?: string | null;
};

export type RetentionCleanupRun = {
  id: string;
  trigger: 'CRON' | 'ADMIN';
  status: 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
  policySnapshot: RetentionPolicy;
  resultSnapshot?: unknown;
  startedAt: string;
  completedAt?: string | null;
  errorCode?: string | null;
};

export type RetentionState = {
  policy: RetentionPolicy;
  cutoffs: {
    operationalUsage: string;
    attendanceRaw: string;
    patrolRaw: string;
  };
  timezone: string;
  cleanupDelayHours: number;
  pendingChange?: RetentionPolicyChange | null;
  recentRuns: RetentionCleanupRun[];
  protectedInvariants: string[];
};

function requestId(response: Response, payload?: unknown) {
  const header = normalizeRequestId(response.headers?.get?.('x-request-id'));
  if (header) return header;
  if (payload && typeof payload === 'object' && 'requestId' in payload) {
    return normalizeRequestId((payload as { requestId?: unknown }).requestId);
  }
  return undefined;
}

async function callRetention(path: string, token: string, init: RequestInit = {}) {
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
      payload?.error || 'Data retention operation failed',
      response.status,
      requestId(response, payload),
      payload?.details
    );
  }
  return payload;
}

export function getRetentionPolicies(token: string) {
  return callRetention('/retention-policies', token);
}

export function previewRetentionPolicy(token: string, proposedPolicy: Omit<RetentionPolicy, 'timezone'>) {
  return callRetention('/retention-policies/preview', token, {
    method: 'POST',
    body: JSON.stringify({ proposedPolicy })
  });
}

export function createRetentionChange(token: string, input: {
  proposedPolicy: Omit<RetentionPolicy, 'timezone'>;
  expectedPreviewDigest: string;
  acknowledgeImpact: boolean;
  reason: string;
}) {
  return callRetention('/retention-policies/changes', token, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function cancelRetentionChange(token: string, id: string, reason: string) {
  return callRetention(`/retention-policies/changes/${encodeURIComponent(id)}/cancel`, token, {
    method: 'POST',
    body: JSON.stringify({ reason })
  });
}

export function runRetentionCleanup(token: string, input: { acknowledgeCleanup: true; batchSize?: number; maxBatches?: number }) {
  return callRetention('/retention-cleanup/run', token, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function getRetentionCleanupRuns(token: string, limit = 10) {
  return callRetention(`/retention-cleanup/runs?limit=${encodeURIComponent(String(limit))}`, token);
}
