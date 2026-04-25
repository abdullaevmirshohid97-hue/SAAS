#!/usr/bin/env node
// =============================================================================
// Clary v2 — Demo tenant seeder
// Provisions a "demo" clinic with realistic data so public demo sessions have
// meaningful content (patients, services, rooms, medications, lab tests,
// diagnostic equipment, recent transactions, support ticket sample, etc.).
// Safe to run repeatedly.
// =============================================================================
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

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

const DEMO_SLUG = 'demo';
const DEMO_CLINIC_ID = '33333333-3333-3333-3333-333333333333';
const DEMO_ADMIN_EMAIL = 'demo-admin@clary.uz';
const DEMO_ADMIN_PASS = 'Demo!2026';

const log = (...args) => console.log('▶', ...args);
const warn = (...args) => console.warn('⚠', ...args);

async function ensureClinic() {
  const { data: existing } = await admin
    .from('clinics')
    .select('id')
    .eq('slug', DEMO_SLUG)
    .maybeSingle();
  if (existing) return existing.id;
  const { error } = await admin.from('clinics').insert({
    id: DEMO_CLINIC_ID,
    slug: DEMO_SLUG,
    name: 'Clary Demo Klinikasi',
    legal_name: 'Clary Demo LLC',
    country: 'UZ',
    city: 'Toshkent',
    address: 'Amir Temur ko‘chasi, 1',
    phone: '+998 71 000 00 00',
    email: 'demo@clary.uz',
    timezone: 'Asia/Tashkent',
    default_locale: 'uz-Latn',
    currency: 'UZS',
    settings: { is_demo: true, brand: { primary_color: '#2563EB' } },
  });
  if (error) throw error;
  return DEMO_CLINIC_ID;
}

async function ensureDemoAdmin(clinicId) {
  const list = await admin.auth.admin.listUsers();
  const existing = list.data?.users.find((u) => u.email === DEMO_ADMIN_EMAIL);
  let id;
  if (existing) {
    id = existing.id;
    await admin.auth.admin.updateUserById(id, {
      password: DEMO_ADMIN_PASS,
      email_confirm: true,
      app_metadata: { clinic_id: clinicId, role: 'clinic_admin', is_demo: true },
    });
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: DEMO_ADMIN_EMAIL,
      password: DEMO_ADMIN_PASS,
      email_confirm: true,
      app_metadata: { clinic_id: clinicId, role: 'clinic_admin', is_demo: true },
      user_metadata: { full_name: 'Demo Admin' },
    });
    if (error) throw error;
    id = data.user.id;
  }
  await admin.from('profiles').upsert(
    { id, clinic_id: clinicId, email: DEMO_ADMIN_EMAIL, full_name: 'Demo Admin', role: 'clinic_admin', is_active: true },
    { onConflict: 'id' },
  );
  return id;
}

async function seedServicesAndRooms(clinicId, createdBy) {
  const { count: catCount } = await admin
    .from('service_categories')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId);
  if ((catCount ?? 0) === 0) {
    await admin.from('service_categories').insert([
      { clinic_id: clinicId, created_by: createdBy, name_i18n: { 'uz-Latn': 'Umumiy', ru: 'Общие', en: 'General' }, icon: 'stethoscope', sort_order: 1 },
      { clinic_id: clinicId, created_by: createdBy, name_i18n: { 'uz-Latn': 'Stomatologiya', ru: 'Стоматология', en: 'Dental' }, icon: 'tooth', sort_order: 2 },
      { clinic_id: clinicId, created_by: createdBy, name_i18n: { 'uz-Latn': 'Diagnostika', ru: 'Диагностика', en: 'Diagnostics' }, icon: 'activity', sort_order: 3 },
    ]);
  }

  const { count: svcCount } = await admin
    .from('services')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId);
  if ((svcCount ?? 0) === 0) {
    await admin.from('services').insert([
      { clinic_id: clinicId, created_by: createdBy, name_i18n: { 'uz-Latn': 'Shifokor qabuli', ru: 'Прием врача', en: 'Consultation' }, price_uzs: 150000, duration_min: 30 },
      { clinic_id: clinicId, created_by: createdBy, name_i18n: { 'uz-Latn': 'UZI tekshiruvi', ru: 'УЗИ', en: 'Ultrasound' }, price_uzs: 220000, duration_min: 30 },
      { clinic_id: clinicId, created_by: createdBy, name_i18n: { 'uz-Latn': 'EKG', ru: 'ЭКГ', en: 'ECG' }, price_uzs: 90000, duration_min: 15 },
      { clinic_id: clinicId, created_by: createdBy, name_i18n: { 'uz-Latn': 'Tish plomba', ru: 'Пломба', en: 'Dental filling' }, price_uzs: 350000, duration_min: 45 },
    ]);
  }

  const { count: roomCount } = await admin.from('rooms').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId);
  if ((roomCount ?? 0) === 0) {
    await admin.from('rooms').insert([
      { clinic_id: clinicId, created_by: createdBy, number: '101', name_i18n: { 'uz-Latn': 'Qabul 101' }, type: 'consultation', floor: 1, capacity: 1 },
      { clinic_id: clinicId, created_by: createdBy, number: '201', name_i18n: { 'uz-Latn': 'UZI xonasi' }, type: 'diagnostic', floor: 2, capacity: 1 },
      { clinic_id: clinicId, created_by: createdBy, number: '305', name_i18n: { 'uz-Latn': 'Stomatologiya' }, type: 'procedure', floor: 3, capacity: 1 },
    ]);
  }
}

async function seedMedications(clinicId) {
  const { count } = await admin.from('medications').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId);
  if ((count ?? 0) > 0) return;
  const meds = [
    { name: 'Paracetamol 500mg', generic_name: 'Paracetamol', form: 'tablet', strength: '500mg', price_uzs: 1200, stock_qty: 2000 },
    { name: 'Amoxicillin 500mg', generic_name: 'Amoxicillin', form: 'capsule', strength: '500mg', price_uzs: 1800, stock_qty: 800 },
    { name: 'Ibuprofen 400mg', generic_name: 'Ibuprofen', form: 'tablet', strength: '400mg', price_uzs: 1500, stock_qty: 1200 },
    { name: 'Omeprazole 20mg', generic_name: 'Omeprazole', form: 'capsule', strength: '20mg', price_uzs: 2500, stock_qty: 600 },
    { name: 'Cetirizine 10mg', generic_name: 'Cetirizine', form: 'tablet', strength: '10mg', price_uzs: 1700, stock_qty: 400 },
  ];
  const { error } = await admin
    .from('medications')
    .insert(meds.map((m) => ({ ...m, clinic_id: clinicId, currency: 'UZS', is_active: true })));
  if (error) warn('medications:', error.message);
}

async function seedDiagnosticEquipment(clinicId) {
  const { count } = await admin.from('diagnostic_equipment').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId);
  if ((count ?? 0) > 0) return;
  const items = [
    { name: 'X-Ray Siemens Multix', modality: 'xray', manufacturer: 'Siemens', model: 'Multix', is_active: true },
    { name: 'Ultrasound Mindray DC-60', modality: 'ultrasound', manufacturer: 'Mindray', model: 'DC-60', is_active: true },
    { name: 'MRI Philips Ingenia 1.5T', modality: 'mri', manufacturer: 'Philips', model: 'Ingenia 1.5T', is_active: true },
    { name: 'CT Canon Aquilion', modality: 'ct', manufacturer: 'Canon', model: 'Aquilion Prime', is_active: true },
    { name: 'ECG Schiller Cardiovit', modality: 'ecg', manufacturer: 'Schiller', model: 'Cardiovit AT-1', is_active: true },
    { name: 'EchoCG GE Vivid E95', modality: 'echo', manufacturer: 'GE', model: 'Vivid E95', is_active: true },
    { name: 'Mammograph Hologic Selenia', modality: 'mammography', manufacturer: 'Hologic', model: 'Selenia', is_active: true },
  ];
  const { error } = await admin
    .from('diagnostic_equipment')
    .insert(items.map((it) => ({ ...it, clinic_id: clinicId })));
  if (error) warn('equipment:', error.message);
}

async function seedPatients(clinicId, createdBy) {
  const { count } = await admin.from('patients').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId);
  if ((count ?? 0) >= 20) return;
  const firstNames = ['Aziza', 'Jasur', 'Dilnoza', 'Sardor', 'Madina', 'Bobur', 'Nilufar', 'Otabek', 'Sevara', 'Rustam'];
  const lastNames = ['Karimova', 'Yusupov', 'Rahimova', 'Qodirov', 'Saidova', 'Abdullaev', 'Tursunova', 'Xolmatov', 'Kamolova', 'Jo‘raev'];
  const rows = [];
  for (let i = 0; i < 25; i += 1) {
    const fn = firstNames[i % firstNames.length];
    const ln = lastNames[i % lastNames.length];
    const year = 1960 + ((i * 7) % 45);
    rows.push({
      id: randomUUID(),
      clinic_id: clinicId,
      created_by: createdBy,
      full_name: `${fn} ${ln}`,
      phone: `+99890${String(1000000 + i * 37).slice(-7)}`,
      birth_date: `${year}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
      gender: i % 2 === 0 ? 'female' : 'male',
    });
  }
  const { error } = await admin.from('patients').insert(rows);
  if (error) warn('patients:', error.message);
}

async function seedTransactions(clinicId) {
  const { count } = await admin
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId);
  if ((count ?? 0) >= 30) return;
  const methods = ['cash', 'card', 'click', 'payme', 'uzum'];
  const rows = [];
  for (let i = 0; i < 60; i += 1) {
    const daysAgo = i % 30;
    rows.push({
      clinic_id: clinicId,
      kind: 'payment',
      method: methods[i % methods.length],
      amount_uzs: 80000 + ((i * 13_000) % 450_000),
      is_void: false,
      created_at: new Date(Date.now() - daysAgo * 86400_000 - (i * 3600_000)).toISOString(),
    });
  }
  const { error } = await admin.from('transactions').insert(rows);
  if (error) warn('transactions:', error.message);
}

async function seedSupportTicket(clinicId, createdBy) {
  const { count } = await admin
    .from('support_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId);
  if ((count ?? 0) >= 1) return;
  const { error } = await admin.from('support_tickets').insert({
    clinic_id: clinicId,
    created_by: createdBy,
    subject: 'Xush kelibsiz! Clary demo rejimi haqida',
    category: 'onboarding',
    status: 'open',
    priority: 'normal',
  });
  if (error) warn('support:', error.message);
}

async function main() {
  log(`Seeding demo tenant against ${SUPABASE_URL}`);
  const clinicId = await ensureClinic();
  log(`demo clinic  id=${clinicId}`);
  const adminId = await ensureDemoAdmin(clinicId);
  log(`demo admin   id=${adminId}`);
  await seedServicesAndRooms(clinicId, adminId);
  log('services + rooms ok');
  await seedMedications(clinicId);
  log('medications ok');
  await seedDiagnosticEquipment(clinicId);
  log('diagnostic equipment ok');
  await seedPatients(clinicId, adminId);
  log('patients ok');
  await seedTransactions(clinicId);
  log('transactions ok');
  await seedSupportTicket(clinicId, adminId);
  log('support ticket ok');
  console.log();
  console.log('✅ Demo tenant is ready.');
  console.log('   Slug: demo');
  console.log('   Admin:', DEMO_ADMIN_EMAIL, '/', DEMO_ADMIN_PASS);
}

main().catch((err) => {
  console.error('❌ Demo seed failed:', err);
  process.exit(1);
});
