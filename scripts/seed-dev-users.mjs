#!/usr/bin/env node
// =============================================================================
// Clary v2 — Dev user seeder
// Creates: 1 super admin + 2 clinic admins (one per demo clinic) + sample
// catalog data (services, rooms) for the demo clinics.
// Run after `supabase start` + migrations + seed.sql.
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
const CLINIC_DMC = '22222222-2222-2222-2222-222222222222';

async function upsertUser({ email, password, fullName, role, clinicId }) {
  const list = await admin.auth.admin.listUsers();
  if (list.error) throw list.error;
  const existing = list.data.users.find((u) => u.email === email);
  let userId;
  if (existing) {
    userId = existing.id;
    await admin.auth.admin.updateUserById(userId, {
      password,
      app_metadata: { clinic_id: clinicId, role },
      email_confirm: true,
    });
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { clinic_id: clinicId, role },
      user_metadata: { full_name: fullName },
    });
    if (error) throw error;
    userId = data.user.id;
  }

  const { error: profErr } = await admin
    .from('profiles')
    .upsert(
      {
        id: userId,
        clinic_id: clinicId,
        role,
        full_name: fullName,
        email,
        is_active: true,
      },
      { onConflict: 'id' },
    );
  if (profErr) throw profErr;

  console.log(`  ${email.padEnd(30)}  role=${role}  id=${userId}`);
  return userId;
}

async function seedCatalog(clinicId, createdBy) {
  // service_categories (no unique constraint on (clinic_id,name_i18n) → skip if any exist)
  const { count: catCount } = await admin
    .from('service_categories')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId);
  if ((catCount ?? 0) === 0) {
    const cats = [
      { name_i18n: { 'uz-Latn': 'Umumiy', ru: 'Общие', en: 'General' }, icon: 'stethoscope', sort_order: 1 },
      { name_i18n: { 'uz-Latn': 'Stomatologiya', ru: 'Стоматология', en: 'Dental' }, icon: 'tooth', sort_order: 2 },
    ];
    const { error } = await admin
      .from('service_categories')
      .insert(cats.map((c) => ({ ...c, clinic_id: clinicId, created_by: createdBy })));
    if (error) console.warn('cat err', error);
  }

  const { count: svcCount } = await admin
    .from('services')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId);
  if ((svcCount ?? 0) === 0) {
    const services = [
      { name_i18n: { 'uz-Latn': 'Shifokor qabuli', ru: 'Прием врача', en: 'Consultation' }, price_uzs: 150000, duration_min: 30 },
      { name_i18n: { 'uz-Latn': 'Tish olib tashlash', ru: 'Удаление зуба', en: 'Tooth extraction' }, price_uzs: 300000, duration_min: 45 },
    ];
    const { error } = await admin
      .from('services')
      .insert(services.map((s) => ({ ...s, clinic_id: clinicId, created_by: createdBy })));
    if (error) console.warn('svc err', error);
  }

  const { count: roomCount } = await admin
    .from('rooms')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId);
  if ((roomCount ?? 0) === 0) {
    const rooms = [
      { number: '101', name_i18n: { 'uz-Latn': 'Kabinet 101' }, type: 'consultation', floor: 1, capacity: 1 },
      { number: '102', name_i18n: { 'uz-Latn': 'Kabinet 102' }, type: 'consultation', floor: 1, capacity: 1 },
    ];
    const { error } = await admin
      .from('rooms')
      .insert(rooms.map((r) => ({ ...r, clinic_id: clinicId, created_by: createdBy })));
    if (error) console.warn('room err', error);
  }
}

async function main() {
  console.log('▶ Seeding dev users against', SUPABASE_URL);
  console.log();

  const superId = await upsertUser({
    email: 'founder@clary.uz',
    password: 'Founder!2026',
    fullName: 'Clary Founder',
    role: 'super_admin',
    clinicId: null,
  });

  const nurId = await upsertUser({
    email: 'admin@nur.uz',
    password: 'Admin!2026',
    fullName: 'NUR Klinika Admini',
    role: 'clinic_admin',
    clinicId: CLINIC_NUR,
  });

  const dmcId = await upsertUser({
    email: 'admin@dmc.uz',
    password: 'Admin!2026',
    fullName: 'Diagnostika Markazi Admini',
    role: 'clinic_admin',
    clinicId: CLINIC_DMC,
  });

  await upsertUser({
    email: 'doctor@nur.uz',
    password: 'Doctor!2026',
    fullName: 'Dr. Karimov',
    role: 'doctor',
    clinicId: CLINIC_NUR,
  });

  await upsertUser({
    email: 'reception@nur.uz',
    password: 'Reception!2026',
    fullName: 'Qabulxona xodimi',
    role: 'receptionist',
    clinicId: CLINIC_NUR,
  });

  console.log();
  console.log('▶ Seeding catalog for NUR Klinika');
  await seedCatalog(CLINIC_NUR, nurId);
  console.log('▶ Seeding catalog for Diagnostika Markazi');
  await seedCatalog(CLINIC_DMC, dmcId);

  console.log();
  console.log('✅ Done! Try these credentials:');
  console.log('   Super admin:   founder@clary.uz     / Founder!2026    (web-admin)');
  console.log('   NUR admin:     admin@nur.uz         / Admin!2026      (web-clinic)');
  console.log('   DMC admin:     admin@dmc.uz         / Admin!2026      (web-clinic)');
  console.log('   NUR doctor:    doctor@nur.uz        / Doctor!2026     (web-clinic/mobile)');
  console.log('   NUR reception: reception@nur.uz     / Reception!2026  (web-clinic)');
  console.log();
  void superId; void dmcId;
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
