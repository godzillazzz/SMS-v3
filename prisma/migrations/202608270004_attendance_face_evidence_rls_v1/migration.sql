-- Attendance live-photo evidence is private server-side metadata only.
-- Block Supabase Data API roles when present while remaining portable to
-- isolated PostgreSQL CI environments that do not define Supabase roles.

ALTER TABLE public."attendance_evidence" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public."attendance_evidence" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public."attendance_evidence" FROM authenticated';
  END IF;
END
$$;
