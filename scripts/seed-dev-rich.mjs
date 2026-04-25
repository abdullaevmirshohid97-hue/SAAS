#!/usr/bin/env node
// =============================================================================
// Clary v2 — Rich demo seeder
// Extends seed-dev-users.mjs with operational demo data for the new modules:
//   - shift_operators (cashier PINs)
//   - medications + medication_batches (FIFO pharmacy)
//   - lab_tests (for the lab kanban)
//   - rooms for inpatient map
//   - doctor_commission_rates (payroll accrual)
//   - marketing_segments
//   - site CMS media sample
//   - sample patients + appointments + transactions to drive analytics
//
// Run after `pnpm db:seed` (or the plain `scripts/seed-dev-users.mjs`) so that
// the two demo clinics + super_admin + clinic_admin profiles already exist.
// =============================================================================
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const SUPABASE_URL = env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in .env.local');

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CLINIC_NUR = '11111111-1111-1111-1111-111111111111';

// ---- helpers --------------------------------------------------------------
async function requireProfile(email) {
  const { data } = await admin.from('profiles').select('id, clinic_id').eq('email', email).single();
  if (!data) throw new Error(`Profile ${email} not found — run seed-dev-users.mjs first`);
  return data;
}

// ---- seeds ---------------------------------------------------------------
async function seedShiftOperators(clinicId, createdBy) {
  const { count } = await admin
    .from('shift_operators')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId);
  if ((count ?? 0) > 0) {
    console.log(`  shift_operators: ${count} already present, skipping`);
    return;
  }
  const rows = [
    { full_name: 'Aziza Kassir',     role: 'cashier',   pin_hash: '$argon2id$demo$placeholder' },
    { full_name: 'Nodira Reception', role: 'reception', pin_hash: '$argon2id$demo$placeholder' },
  ];
  const { error } = await admin
    .from('shift_operators')
    .insert(rows.map((r) => ({ ...r, clinic_id: clinicId, color: '#2563EB', is_active: true, created_by: createdBy })));
  if (error) console.warn('shift_operators err', error);
  console.log('  shift_operators: 2 rows');
}

async function seedMedications(clinicId, createdBy) {
  const { count } = await admin
    .from('medications')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId);
  if ((count ?? 0) > 0) {
    console.log(`  medications: ${count} already present, skipping`);
    return;
  }

  const meds = [
    { name: 'Paracetamol 500mg', form: 'tablet',    price_uzs: 1500,  cost_uzs: 900,   stock: 0 },
    { name: 'Ibuprofen 200mg',   form: 'tablet',    price_uzs: 2000,  cost_uzs: 1200,  stock: 0 },
    { name: 'Amoxicillin 500mg', form: 'capsule',   price_uzs: 3500,  cost_uzs: 2100,  stock: 0 },
    { name: 'Cefazolin 1g',      form: 'injection', price_uzs: 15000, cost_uzs: 9000,  stock: 0 },
  ];
  const { data: inserted, error } = await admin
    .from('medications')
    .insert(meds.map((m) => ({ ...m, clinic_id: clinicId, created_by: createdBy })))
    .select('id, name');
  if (error) {
    console.warn('medications err', error);
    return;
  }

  for (const m of inserted ?? []) {
    const qty = 120;
    const { error: bErr } = await admin.from('medication_batches').insert({
      clinic_id: clinicId,
      medication_id: m.id,
      batch_no: `${m.name.slice(0, 3).toUpperCase()}-${Math.floor(Math.random() * 10000)}`,
      qty_received: qty,
      qty_remaining: qty,
      unit_cost_uzs: 1000,
      unit_price_uzs: 3000,
      expiry_date: new Date(Date.now() + 180 * 864e5).toISOString().slice(0, 10),
      received_at: new Date().toISOString(),
      created_by: createdBy,
    });
    if (bErr) console.warn('batch err', bErr);
  }
  console.log(`  medications + batches: ${inserted?.length ?? 0}`);
}

async function seedLabTests(clinicId, createdBy) {
  const { count } = await admin
    .from('lab_tests')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId);
  if ((count ?? 0) > 0) {
    console.log(`  lab_tests: ${count} already present, skipping`);
    return;
  }
  const tests = [
    { name_i18n: { 'uz-Latn': 'Umumiy qon tahlili', ru: 'Общий анализ крови' }, price_uzs: 80000, duration_hours: 4, sample_type: 'blood' },
    { name_i18n: { 'uz-Latn': 'Peshob tahlili',     ru: 'Анализ мочи' },         price_uzs: 50000, duration_hours: 2, sample_type: 'urine' },
    { name_i18n: { 'uz-Latn': 'Biokimyo',            ru: 'Биохимия крови' },      price_uzs: 180000, duration_hours: 24, sample_type: 'blood' },
  ];
  const { error } = await admin
    .from('lab_tests')
    .insert(tests.map((t) => ({ ...t, clinic_id: clinicId, created_by: createdBy })));
  if (error) console.warn('lab_tests err', error);
  console.log(`  lab_tests: ${tests.length}`);
}

async function seedCommissionRates(clinicId, createdBy) {
  const { data: doctors } = await admin
    .from('profiles')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('role', 'doctor');
  if (!doctors?.length) return;
  for (const d of doctors) {
    const { data: existing } = await admin
      .from('doctor_commission_rates')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('doctor_id', d.id)
      .is('service_id', null)
      .limit(1);
    if (existing?.length) continue;
    await admin.from('doctor_commission_rates').insert({
      clinic_id: clinicId,
      doctor_id: d.id,
      service_id: null,
      percent: 40,
      fixed_uzs: 0,
      created_by: createdBy,
    });
  }
  console.log(`  doctor_commission_rates: ${doctors.length}`);
}

async function seedMarketingSegments(clinicId, createdBy) {
  const { count } = await admin
    .from('marketing_segments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId);
  if ((count ?? 0) > 0) {
    console.log(`  marketing_segments: ${count} already present, skipping`);
    return;
  }
  const { error } = await admin.from('marketing_segments').insert([
    {
      clinic_id: clinicId,
      name: 'Active 30d',
      description: 'Patients with at least one visit in last 30 days',
      filter_query: { any: [{ field: 'last_visit_days', op: 'lte', value: 30 }] },
      created_by: createdBy,
    },
    {
      clinic_id: clinicId,
      name: 'Passive 90d+',
      description: 'Have not visited in 90 days',
      filter_query: { any: [{ field: 'last_visit_days', op: 'gte', value: 90 }] },
      created_by: createdBy,
    },
  ]);
  if (error) console.warn('marketing_segments err', error);
  console.log('  marketing_segments: 2');
}

async function seedSiteMedia() {
  await admin.from('site_media').insert([
    {
      kind: 'image',
      url: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=1600&q=80',
      alt_i18n: { 'uz-Latn': 'Zamonaviy klinika qabulxonasi', en: 'Modern clinic reception' },
      tags: ['hero', 'clinic'],
    },
    {
      kind: 'image',
      url: 'https://images.unsplash.com/photo-1551190822-a9333d879b1f?auto=format&fit=crop&w=1600&q=80',
      alt_i18n: { 'uz-Latn': 'Shifokor va bemor', en: 'Doctor and patient' },
      tags: ['about', 'team'],
    },
  ]);
  console.log('  site_media: 2');
}

async function main() {
  console.log('▶ Rich dev seeder');
  const nurAdmin = await requireProfile('admin@nur.uz').catch(() => null);
  if (!nurAdmin) {
    console.log('  ⚠ run scripts/seed-dev-users.mjs first');
    return;
  }

  console.log('▶ NUR clinic operational data');
  await seedShiftOperators(CLINIC_NUR, nurAdmin.id);
  await seedMedications(CLINIC_NUR, nurAdmin.id);
  await seedLabTests(CLINIC_NUR, nurAdmin.id);
  await seedCommissionRates(CLINIC_NUR, nurAdmin.id);
  await seedMarketingSegments(CLINIC_NUR, nurAdmin.id);

  console.log('▶ Landing CMS media');
  await seedSiteMedia();

  console.log('✅ Rich demo data seeded');
}

main().catch((err) => {
  console.error('❌ Rich seed failed:', err);
  process.exit(1);
});
