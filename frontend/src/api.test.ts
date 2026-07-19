import { describe, expect, it } from 'vitest';
import { api } from './api';
describe('API client', () => { it('exposes the browser authentication operations', () => { expect(typeof api.login).toBe('function'); expect(typeof api.refresh).toBe('function'); expect(typeof api.logout).toBe('function'); }); });
