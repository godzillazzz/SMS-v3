import { describe, expect, it } from 'vitest';
import { gpsGeofenceDecision, type GeofenceSite } from './pages/attendance-simple/attendance-simple-storage';

const site = (overrides: Partial<GeofenceSite> = {}): GeofenceSite => ({
  id: 'site-a', code: 'A', name: 'Site A', latitude: 13.7241, longitude: 100.5701, geofenceRadiusMeters: 100, ...overrides
});

describe('simple Attendance multi-Site geofence preview', () => {
  it('classifies the assigned Site as normal attendance', () => {
    const assigned = site();
    const result = gpsGeofenceDecision(assigned, { latitude: assigned.latitude, longitude: assigned.longitude, accuracyMeters: 8 }, [assigned]);
    expect(result.workSiteContext).toBe('ASSIGNED_SITE');
    expect(result.actualSite?.id).toBe(assigned.id);
  });

  it('recognizes another cached eligible Site as support work without changing the assignment', () => {
    const assigned = site();
    const support = site({ id: 'site-b', code: 'B', name: 'Site B', latitude: 13.7251, geofenceRadiusMeters: 80 });
    const result = gpsGeofenceDecision(assigned, { latitude: support.latitude, longitude: support.longitude, accuracyMeters: 8 }, [assigned, support]);
    expect(result.workSiteContext).toBe('SUPPORT_SITE');
    expect(result.assignedSite.id).toBe(assigned.id);
    expect(result.actualSite?.id).toBe(support.id);
  });

  it('prefers the assigned Site in an overlap, even if another Site has a closer center', () => {
    const assigned = site();
    const support = site({ id: 'site-b', code: 'B', latitude: 13.72411, geofenceRadiusMeters: 150 });
    const result = gpsGeofenceDecision(assigned, { latitude: support.latitude, longitude: support.longitude, accuracyMeters: 8 }, [support, assigned]);
    expect(result.actualSite?.id).toBe(assigned.id);
    expect(result.workSiteContext).toBe('ASSIGNED_SITE');
  });

  it('uses stable code ordering for an equal normalized support-site match', () => {
    const assigned = site({ latitude: 13.72, geofenceRadiusMeters: 25 });
    const supportZ = site({ id: 'site-z', code: 'Z', latitude: 13.7241, geofenceRadiusMeters: 150 });
    const supportA = site({ id: 'site-a2', code: 'A2', latitude: 13.7241, geofenceRadiusMeters: 150 });
    const result = gpsGeofenceDecision(assigned, { latitude: 13.7241, longitude: 100.5701, accuracyMeters: 8 }, [supportZ, supportA]);
    expect(result.actualSite?.id).toBe(supportA.id);
    expect(result.workSiteContext).toBe('SUPPORT_SITE');
  });

  it('does not treat a point outside every cached active Site as authorized offline', () => {
    const assigned = site();
    const support = site({ id: 'site-b', code: 'B', latitude: 13.7251, geofenceRadiusMeters: 80 });
    const result = gpsGeofenceDecision(assigned, { latitude: 13.73, longitude: 100.57, accuracyMeters: 8 }, [assigned, support]);
    expect(result.classification).toBe('CONFIDENT_OUTSIDE');
    expect(result.workSiteContext).toBe('OUTSIDE_ALL_SITES');
    expect(result.actualSite).toBeNull();
  });
});
