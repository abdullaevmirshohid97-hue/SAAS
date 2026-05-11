-- pgTAP: Sprint 2A/2B/2C jadvallari uchun tenant isolation
-- (nurse_schedules, room_included_services)

BEGIN;

SELECT plan(4);

-- Setup
INSERT INTO clinics (id, slug, name, organization_type) VALUES
  ('33333333-3333-3333-3333-333333333333', 'gamma', 'Gamma Clinic', 'clinic'),
  ('44444444-4444-4444-4444-444444444444', 'delta', 'Delta Clinic', 'clinic')
ON CONFLICT (id) DO NOTHING;

-- Gamma admin JWT
SET LOCAL "request.jwt.claims" TO '{"sub":"user-gamma","app_metadata":{"clinic_id":"33333333-3333-3333-3333-333333333333","role":"clinic_admin"}}';

-- Gamma seeds a profile + room
INSERT INTO profiles (id, clinic_id, email, full_name, role) VALUES
  ('11110000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333',
   'nurse-g@example.com', 'Nurse G', 'nurse')
ON CONFLICT (id) DO NOTHING;

INSERT INTO rooms (id, clinic_id, number, floor, capacity, created_by) VALUES
  ('22220000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333',
   'G101', 1, 1, '11110000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- nurse_schedules: Gamma can insert its own row
SELECT lives_ok(
  $$INSERT INTO nurse_schedules (clinic_id, nurse_id, floor, day_of_week, start_time, end_time)
    VALUES ('33333333-3333-3333-3333-333333333333',
            '11110000-0000-0000-0000-000000000001', 1, 1, '08:00', '20:00')$$,
  'Gamma admin can insert own nurse_schedule'
);

-- nurse_schedules: Gamma cannot insert into Delta
PREPARE s_ns_cross AS INSERT INTO nurse_schedules
  (clinic_id, nurse_id, floor, day_of_week, start_time, end_time)
  VALUES ('44444444-4444-4444-4444-444444444444',
          '11110000-0000-0000-0000-000000000001', 1, 1, '08:00', '20:00');
SELECT throws_ok('EXECUTE s_ns_cross', '42501', NULL,
  'nurse_schedules cross-tenant INSERT blocked');

-- room_included_services: Gamma cannot insert into Delta
PREPARE s_ris_cross AS INSERT INTO room_included_services
  (clinic_id, room_id, service_id, frequency_per_week)
  VALUES ('44444444-4444-4444-4444-444444444444',
          '22220000-0000-0000-0000-000000000001', gen_random_uuid(), 2);
SELECT throws_ok('EXECUTE s_ris_cross', '42501', NULL,
  'room_included_services cross-tenant INSERT blocked');

-- Delta admin cannot see Gamma's nurse_schedules
SET LOCAL "request.jwt.claims" TO '{"sub":"user-delta","app_metadata":{"clinic_id":"44444444-4444-4444-4444-444444444444","role":"clinic_admin"}}';

SELECT is_empty(
  $$SELECT * FROM nurse_schedules
     WHERE clinic_id = '33333333-3333-3333-3333-333333333333'$$,
  'Delta admin CANNOT see Gamma nurse_schedules'
);

SELECT * FROM finish();
ROLLBACK;
