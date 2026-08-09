export type AuditCategory = 'default' | 'technical' | 'all';

export type AuditFilters = {
  dateFrom: string;
  dateTo: string;
  actor: string;
  entityType: string;
  action: string;
  search: string;
  category: AuditCategory;
};

export type AuditEvent = {
  id?: string;
  action?: unknown;
  entityType?: unknown;
  entityId?: unknown;
  module?: unknown;
  category?: unknown;
  metadata?: unknown;
  createdAt?: unknown;
  actor?: { id?: unknown; displayName?: unknown; role?: unknown } | null;
};

export const defaultAuditFilters: AuditFilters = {
  dateFrom: '',
  dateTo: '',
  actor: '',
  entityType: '',
  action: '',
  search: '',
  category: 'default'
};
