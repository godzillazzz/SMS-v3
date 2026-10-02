'use strict';

const { Prisma, PrismaClient } = require('@prisma/client');

const EXPECTED_ENUM_VALUES = Object.freeze(['PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED']);
const EXPECTED_INDEXES = Object.freeze([
  'attendance_events_device_enrollment_id_received_at_idx',
  'attendance_events_review_required_received_at_idx',
  'attendance_pending_events_capture_id_key',
  'attendance_pending_events_attendance_event_id_key',
  'attendance_pending_events_employee_id_captured_at_idx',
  'attendance_pending_events_status_received_at_idx',
  'attendance_pending_events_shift_assignment_id_event_type_idx'
]);
const EXPECTED_CONSTRAINTS = Object.freeze([
  'attendance_events_device_enrollment_id_fkey',
  'attendance_events_source_mode_check',
  'attendance_pending_events_attendance_event_id_fkey',
  'attendance_pending_events_capture_before_receive',
  'attendance_pending_events_employee_id_fkey',
  'attendance_pending_events_offline_only',
  'attendance_pending_events_payload_digest_format',
  'attendance_pending_events_reviewed_by_user_id_fkey',
  'attendance_pending_events_shift_assignment_id_fkey'
]);

function assert(condition, message) {
  if (!condition) throw new Error('G06 migration verification: ' + message);
}

async function verify({ prisma = new PrismaClient(), log = console.log } = {}) {
  const ownsClient = arguments.length === 0 || !arguments[0]?.prisma;
  try {
    const table = await prisma.$queryRaw(Prisma.sql`
      SELECT c.relrowsecurity AS rls_enabled,
             (SELECT COUNT(*)::int FROM pg_policies p
              WHERE p.schemaname = 'public' AND p.tablename = 'attendance_pending_events') AS policy_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'attendance_pending_events'
        AND c.relkind = 'r'
    `);
    assert(table.length === 1, 'pending-events table is missing');
    assert(table[0].rls_enabled === true, 'pending-events RLS is not enabled');
    assert(Number(table[0].policy_count) === 0, 'pending-events unexpectedly has a client policy');

    const rolePrivileges = await prisma.$queryRaw(Prisma.sql`
      SELECT r.rolname,
        has_table_privilege(r.oid, 'public.attendance_pending_events', 'SELECT') AS can_select,
        has_table_privilege(r.oid, 'public.attendance_pending_events', 'INSERT') AS can_insert,
        has_table_privilege(r.oid, 'public.attendance_pending_events', 'UPDATE') AS can_update,
        has_table_privilege(r.oid, 'public.attendance_pending_events', 'DELETE') AS can_delete,
        has_table_privilege(r.oid, 'public.attendance_pending_events', 'TRUNCATE') AS can_truncate,
        has_table_privilege(r.oid, 'public.attendance_pending_events', 'REFERENCES') AS can_reference,
        has_table_privilege(r.oid, 'public.attendance_pending_events', 'TRIGGER') AS can_trigger
      FROM pg_roles r
      WHERE r.rolname IN ('anon', 'authenticated')
      ORDER BY r.rolname
    `);
    assert(rolePrivileges.length === 2, 'expected anon and authenticated roles were not both found');
    for (const role of rolePrivileges) {
      assert(
        !['can_select', 'can_insert', 'can_update', 'can_delete', 'can_truncate', 'can_reference', 'can_trigger']
          .some((key) => role[key] === true),
        'client table privilege remains granted to a browser role'
      );
    }

    const enumRows = await prisma.$queryRaw(Prisma.sql`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typname = 'AttendancePendingEventStatus'
      ORDER BY e.enumsortorder
    `);
    assert(
      enumRows.map((row) => row.enumlabel).join(',') === EXPECTED_ENUM_VALUES.join(','),
      'pending-event status enum mismatch'
    );

    const indexes = await prisma.$queryRaw(Prisma.sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('attendance_events_device_enrollment_id_received_at_idx',
          'attendance_events_review_required_received_at_idx',
          'attendance_pending_events_capture_id_key',
          'attendance_pending_events_attendance_event_id_key',
          'attendance_pending_events_employee_id_captured_at_idx',
          'attendance_pending_events_status_received_at_idx',
          'attendance_pending_events_shift_assignment_id_event_type_idx')
      ORDER BY indexname
    `);
    assert(indexes.length === EXPECTED_INDEXES.length, 'required Attendance index set is incomplete');

    const constraints = await prisma.$queryRaw(Prisma.sql`
      SELECT conname, convalidated
      FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
        AND conname IN (
          'attendance_events_device_enrollment_id_fkey',
          'attendance_events_source_mode_check',
          'attendance_pending_events_attendance_event_id_fkey',
          'attendance_pending_events_capture_before_receive',
          'attendance_pending_events_employee_id_fkey',
          'attendance_pending_events_offline_only',
          'attendance_pending_events_payload_digest_format',
          'attendance_pending_events_reviewed_by_user_id_fkey',
          'attendance_pending_events_shift_assignment_id_fkey'
        )
      ORDER BY conname
    `);
    assert(constraints.length === EXPECTED_CONSTRAINTS.length, 'required Attendance constraints are incomplete');
    assert(constraints.every((row) => row.convalidated === true), 'an Attendance constraint is not validated');

    const columns = await prisma.$queryRaw(Prisma.sql`
      SELECT table_name, column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'attendance_device_enrollments' AND column_name = 'observation_only')
          OR (table_name = 'attendance_events' AND column_name IN (
            'face_verification_session_id', 'device_enrollment_id', 'source_mode',
            'device_captured_at', 'review_required', 'review_reasons'
          ))
          OR (table_name = 'attendance_pending_events' AND column_name IN (
            'id', 'employee_id', 'shift_assignment_id', 'capture_id', 'event_type',
            'source_mode', 'captured_at', 'received_at', 'location_evidence',
            'device_snapshot', 'risk_flags', 'payload_digest', 'status',
            'reviewed_by_user_id', 'reviewed_at', 'review_comment',
            'attendance_event_id', 'created_at', 'updated_at'
          ))
        )
    `);
    const columnSet = new Set(columns.map((row) => row.table_name + '.' + row.column_name));
    const expectedColumns = [
      'attendance_device_enrollments.observation_only',
      'attendance_events.face_verification_session_id',
      'attendance_events.device_enrollment_id',
      'attendance_events.source_mode',
      'attendance_events.device_captured_at',
      'attendance_events.review_required',
      'attendance_events.review_reasons',
      ...[
        'id', 'employee_id', 'shift_assignment_id', 'capture_id', 'event_type',
        'source_mode', 'captured_at', 'received_at', 'location_evidence',
        'device_snapshot', 'risk_flags', 'payload_digest', 'status',
        'reviewed_by_user_id', 'reviewed_at', 'review_comment',
        'attendance_event_id', 'created_at', 'updated_at'
      ].map((column) => 'attendance_pending_events.' + column)
    ];
    assert(expectedColumns.every((column) => columnSet.has(column)), 'required Attendance columns are incomplete');
    const faceSession = columns.find((row) => row.table_name === 'attendance_events' && row.column_name === 'face_verification_session_id');
    assert(faceSession?.is_nullable === 'YES', 'Face-session field must be nullable under the approved simplified contract');

    log('G06_SIMPLE_ATTENDANCE_PRODUCTION_MIGRATION_VERIFY=PASS');
    log('PENDING_EVENTS_TABLE=present');
    log('PENDING_EVENTS_RLS=enabled');
    log('PENDING_EVENTS_POLICIES=0');
    log('PENDING_EVENTS_ANON_AUTHENTICATED_PRIVILEGES=0');
    log('PENDING_EVENTS_ENUM_VALUES=3');
    log('ATTENDANCE_INDEXES=' + EXPECTED_INDEXES.length);
    log('ATTENDANCE_CONSTRAINTS_VALIDATED=' + EXPECTED_CONSTRAINTS.length);
    log('RAW_ATTENDANCE_DATA_EMITTED=false');
    return true;
  } finally {
    if (ownsClient) await prisma.$disconnect();
  }
}

if (require.main === module) {
  verify().catch((error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}

module.exports = { EXPECTED_CONSTRAINTS, EXPECTED_ENUM_VALUES, EXPECTED_INDEXES, verify };
