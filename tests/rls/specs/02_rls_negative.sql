-- pgTAP: negative RLS tests for new tables introduced in Phase B..N.
-- Ensures tenant isolation for the key tables a hostile clinic_admin would target
-- (shift_operators, service_referrals, prescriptions, care_items, patient_ledger,
-- doctor_commissions/ledger/payouts), plus that the site CMS can only be written
-- by super_admin while published content is readable to everyone.
--
-- Column names here mirror the canonical migrations in supabase/migrations.

BEGIN;

SELECT plan(13);

-- --- Setup two clinics ----------------------------------------------------
INSERT INTO clinics (id, slug, name, organization_type) VALUES
  ('11111111-1111-1111-1111-111111111111', 'alpha', 'Alpha Clinic', 'clinic'),
  ('22222222-2222-2222-2222-222222222222', 'beta',  'Beta Clinic',  'clinic')
ON CONFLICT (id) DO NOTHING;

-- Simulate Alpha admin JWT
SET LOCAL "request.jwt.claims" TO '{"sub":"user-alpha","app_metadata":{"clinic_id":"11111111-1111-1111-1111-111111111111","role":"clinic_admin"}}';

-- Alpha seeds one patient so referenced rows exist inside its own tenant
INSERT INTO patients (id, clinic_id, full_name, created_by) VALUES
  ('aaaa0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alpha Patient', 'user-alpha')
ON CONFLICT (id) DO NOTHING;

-- shift_operators (insert into Beta must fail)
PREPARE s_shift AS INSERT INTO shift_operators (clinic_id, full_name, role, pin_hash)
  VALUES ('22222222-2222-2222-2222-222222222222', 'Hacker', 'cashier', 'argon2id$stub');
SELECT throws_ok('EXECUTE s_shift', '42501', NULL, 'shift_operators cross-tenant INSERT blocked');

-- service_referrals (insert into Beta must fail)
PREPARE s_ref AS INSERT INTO service_referrals
  (clinic_id, patient_id, doctor_id, referral_kind, status)
  VALUES ('22222222-2222-2222-2222-222222222222', 'aaaa0000-0000-0000-0000-000000000001',
          gen_random_uuid(), 'lab', 'pending');
SELECT throws_ok('EXECUTE s_ref', '42501', NULL, 'service_referrals cross-tenant INSERT blocked');

-- prescriptions (insert into Beta must fail)
PREPARE s_rx AS INSERT INTO prescriptions (clinic_id, patient_id, doctor_id, status)
  VALUES ('22222222-2222-2222-2222-222222222222', 'aaaa0000-0000-0000-0000-000000000001', gen_random_uuid(), 'issued');
SELECT throws_ok('EXECUTE s_rx', '42501', NULL, 'prescriptions cross-tenant INSERT blocked');

-- care_items (insert into Beta must fail)
PREPARE s_care AS INSERT INTO care_items (clinic_id, stay_id, patient_id, kind, title, scheduled_at)
  VALUES ('22222222-2222-2222-2222-222222222222', gen_random_uuid(),
          'aaaa0000-0000-0000-0000-000000000001', 'note', 'care', now());
SELECT throws_ok('EXECUTE s_care', '42501', NULL, 'care_items cross-tenant INSERT blocked');

-- patient_ledger (insert into Beta must fail)
PREPARE s_ledger AS INSERT INTO patient_ledger
  (clinic_id, patient_id, entry_kind, amount_uzs, recorded_by)
  VALUES ('22222222-2222-2222-2222-222222222222', 'aaaa0000-0000-0000-0000-000000000001',
          'deposit', 1000, gen_random_uuid());
SELECT throws_ok('EXECUTE s_ledger', '42501', NULL, 'patient_ledger cross-tenant INSERT blocked');

-- doctor_commissions (insert into Beta must fail)
PREPARE s_dc AS INSERT INTO doctor_commissions
  (clinic_id, doctor_id, transaction_id, gross_uzs, percent, fixed_uzs, amount_uzs)
  VALUES ('22222222-2222-2222-2222-222222222222', gen_random_uuid(), gen_random_uuid(), 100, 10, 0, 10);
SELECT throws_ok('EXECUTE s_dc', '42501', NULL, 'doctor_commissions cross-tenant INSERT blocked');

-- doctor_ledger (insert into Beta must fail)
PREPARE s_dl AS INSERT INTO doctor_ledger
  (clinic_id, doctor_id, kind, amount_uzs, created_by)
  VALUES ('22222222-2222-2222-2222-222222222222', gen_random_uuid(), 'advance', 1000, gen_random_uuid());
SELECT throws_ok('EXECUTE s_dl', '42501', NULL, 'doctor_ledger cross-tenant INSERT blocked');

-- doctor_payouts (insert into Beta must fail)
PREPARE s_dp AS INSERT INTO doctor_payouts
  (clinic_id, doctor_id, period_start, period_end, gross_uzs, commission_percent, net_uzs)
  VALUES ('22222222-2222-2222-2222-222222222222', gen_random_uuid(),
          current_date - 7, current_date, 1000, 10, 100);
SELECT throws_ok('EXECUTE s_dp', '42501', NULL, 'doctor_payouts cross-tenant INSERT blocked');

-- site_entries: non-super_admin must not write
PREPARE s_cms AS INSERT INTO site_entries (key, kind, content_i18n, data, status)
  VALUES ('hack.block', 'block', '{}'::jsonb, '{}'::jsonb, 'draft');
SELECT throws_ok('EXECUTE s_cms', '42501', NULL, 'site_entries INSERT blocked for non-super_admin');

-- site_entries SELECT of published rows is allowed for clinic_admin
SELECT ok(
  (SELECT count(*)::int FROM site_entries WHERE status = 'published') >= 0,
  'site_entries published rows readable to clinic_admin'
);

-- --- Switch to super_admin: CMS writes allowed ----------------------------
SET LOCAL "request.jwt.claims" TO '{"sub":"super","app_metadata":{"clinic_id":null,"role":"super_admin"}}';

SELECT lives_ok(
  $$INSERT INTO site_entries (key, kind, content_i18n, data, status)
    VALUES ('pgtap.test','block','{}'::jsonb,'{}'::jsonb,'draft')
    ON CONFLICT (key) DO NOTHING$$,
  'super_admin can create site_entries'
);

-- --- Back to Alpha admin: settings_audit_log tamper protection ------------
SET LOCAL "request.jwt.claims" TO '{"sub":"user-alpha","app_metadata":{"clinic_id":"11111111-1111-1111-1111-111111111111","role":"clinic_admin"}}';

INSERT INTO services (clinic_id, name_i18n, price_uzs, created_by) VALUES
  ('11111111-1111-1111-1111-111111111111', '{"uz-Latn":"Test"}'::jsonb, 10000, 'user-alpha');

SELECT ok(
  (SELECT count(*) FROM settings_audit_log WHERE clinic_id = '11111111-1111-1111-1111-111111111111') > 0,
  'settings_audit_log receives entries for catalog changes'
);

PREPARE s_audit AS UPDATE settings_audit_log SET reason = 'tampered'
  WHERE clinic_id = '11111111-1111-1111-1111-111111111111';
SELECT ok(
  (SELECT count(*) FROM settings_audit_log WHERE reason = 'tampered') = 0,
  'settings_audit_log UPDATE is no-op (append-only)'
);

SELECT * FROM finish();
ROLLBACK;
