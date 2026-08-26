import { describe, expect, it } from 'vitest';
import { securitySiteTokenRole } from './security-site-management-auth';

describe('Security Site Admin token role gate', () => {
  it('reads ADMIN role from the access token payload', () => {
    expect(securitySiteTokenRole('x.eyJyb2xlIjoiQURNSU4ifQ.y')).toBe('ADMIN');
  });

  it('does not elevate VIEWER or malformed tokens to Admin', () => {
    expect(securitySiteTokenRole('x.eyJyb2xlIjoiVklFV0VSIn0.y')).toBe('VIEWER');
    expect(securitySiteTokenRole('not-a-jwt')).toBe('');
  });
});
