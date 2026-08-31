import { ApiRequestError, normalizeRequestId } from './api';

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export type ApprovalPolicy = {
  requestType: string;
  label: string;
  reviewerRoles: Array<'ADMIN' | 'MANAGER'>;
  safeReviewerRoles: Array<'ADMIN' | 'MANAGER'>;
  reviewerRolesLocked: boolean;
  dueSoonHours: number;
  overdueHours: number;
  additionalSupervisorAliases: string[];
  additionalManagerAliases: string[];
  protectedInvariants: string[];
};

export type ApprovalPolicyInput = Pick<
  ApprovalPolicy,
  'reviewerRoles' | 'dueSoonHours' | 'overdueHours' | 'additionalSupervisorAliases' | 'additionalManagerAliases'
>;

function requestId(response: Response, payload?: unknown) {
  const fromHeader = normalizeRequestId(response.headers?.get?.('x-request-id'));
  if (fromHeader) return fromHeader;
  if (payload && typeof payload === 'object' && 'requestId' in payload) {
    return normalizeRequestId((payload as { requestId?: unknown }).requestId);
  }
  return undefined;
}

async function callApprovalPolicy(path: string, token: string, init: RequestInit = {}) {
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
      payload?.error || 'Approval policy operation failed',
      response.status,
      requestId(response, payload),
      payload?.details
    );
  }
  return payload;
}

export async function getApprovalPolicies(token: string) {
  return callApprovalPolicy('/approval-policies', token);
}

export async function updateApprovalPolicy(token: string, requestType: string, input: ApprovalPolicyInput) {
  return callApprovalPolicy(`/approval-policies/${encodeURIComponent(requestType)}`, token, {
    method: 'PUT',
    body: JSON.stringify(input)
  });
}
