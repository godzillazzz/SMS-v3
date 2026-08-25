export function securitySiteTokenRole(token: string) {
  try {
    const payload = token.split('.')[1];
    if (!payload || typeof globalThis.atob !== 'function') return '';
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const parsed = JSON.parse(globalThis.atob(padded)) as { role?: unknown };
    return String(parsed.role || '').trim().toUpperCase();
  } catch {
    return '';
  }
}
