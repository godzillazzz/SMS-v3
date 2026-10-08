import { APPROVAL_COUNT_TYPES, approvalCountValue, type ApprovalCountSummary, type ApprovalCountType } from './components/approval-count-badge';

export function approvalCountsFromSummary(value: unknown): ApprovalCountSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const summary = value as { total?: unknown; byType?: unknown };
  const total = approvalCountValue(summary.total);
  const byTypeValue = summary.byType;
  if (total === null || !Number.isSafeInteger(total) || !byTypeValue || typeof byTypeValue !== 'object' || Array.isArray(byTypeValue)) return null;

  const byType = {} as Record<ApprovalCountType, number>;
  for (const type of APPROVAL_COUNT_TYPES) {
    const count = approvalCountValue((byTypeValue as Record<string, unknown>)[type]);
    if (count === null || !Number.isSafeInteger(count)) return null;
    byType[type] = count;
  }
  const sum = APPROVAL_COUNT_TYPES.reduce((value, type) => value + byType[type], 0);
  if (sum !== total) return null;
  return { total, byType };
}

