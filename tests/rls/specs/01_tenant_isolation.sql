-- pgTAP: tenant A must never see tenant B's rows

BEGIN;

SELECT plan(6);

-- Setup two clinics with one patient each
INSERT INTO clinics (id, slug, name, organization_type) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'clinic-a', 'Clinic A', 'clinic'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'clinic-b', 'Clinic B', 'clinic');

-- Simulate JWT for Clinic A admin
SET LOCAL "request.jwt.claims" TO '{"sub":"user-a","app_metadata":{"clinic_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"clinic_admin"}}';

-- A can see its own clinic
SELECT results_eq(
  $$SELECT name FROM clinics WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  $$VALUES ('Clinic A'::text)$$,
  'Clinic A admin can see own clinic'
);

-- A cannot see Clinic B
SELECT is_empty(
  $$SELECT * FROM clinics WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  'Clinic A admin CANNOT see Clinic B'
);

-- A cannot insert a patient into B
PREPARE insert_cross AS INSERT INTO patients (clinic_id, full_name, created_by) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Hack', 'user-a');
SELECT throws_ok('EXECUTE insert_cross', '42501', NULL, 'Cross-tenant INSERT blocked');

-- A cannot update Clinic B
PREPARE upd_cross AS UPDATE clinics SET name = 'Hacked' WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
SELECT ok(
  (SELECT count(*) FROM clinics WHERE name = 'Hacked') = 0,
  'Cross-tenant UPDATE has no effect'
);

-- Switch JWT to super admin
SET LOCAL "request.jwt.claims" TO '{"sub":"super","app_metadata":{"clinic_id":null,"role":"super_admin"}}';

-- Super admin sees both
SELECT is(
  (SELECT count(*)::int FROM clinics),
  2,
  'Super admin sees all clinics'
);

-- Settings audit log cannot be updated (append-only)
INSERT INTO services (clinic_id, name_i18n, price_uzs, created_by) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{"uz-Latn":"Konsultatsiya"}', 50000, 'user-a');

PREPARE upd_audit AS UPDATE settings_audit_log SET reason = 'tampered' WHERE clinic_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
SELECT ok(
  (SELECT count(*) FROM settings_audit_log WHERE reason = 'tampered') = 0,
  'settings_audit_log UPDATE is no-op (append-only rule)'
);

SELECT * FROM finish();
ROLLBACK;
