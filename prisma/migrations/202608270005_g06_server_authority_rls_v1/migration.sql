-- G06 server-authoritative data hardening.
-- These tables are accessed through the SMS V3 backend, not directly through
-- Supabase browser Data API roles. RLS plus grant revocation keeps authority,
-- biometric, device, site and reference-photo metadata server-only.

DO $$
DECLARE
  table_name text;
  protected_tables text[] := ARRAY[
    'attendance_adjustment_events',
    'attendance_adjustment_requests',
    'attendance_adjustment_revisions',
    'attendance_corrections',
    'attendance_device_challenges',
    'attendance_device_change_requests',
    'attendance_device_enrollments',
    'attendance_events',
    'attendance_evidence',
    'attendance_month_certifications',
    'attendance_sessions',
    'employee_reference_photos',
    'face_verification_receipts',
    'face_verification_sessions',
    'security_site_departments',
    'security_site_qr_credentials',
    'security_sites'
  ];
BEGIN
  FOREACH table_name IN ARRAY protected_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', table_name);
    END IF;
  END LOOP;
END
$$;
