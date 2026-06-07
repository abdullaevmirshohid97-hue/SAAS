// Bir martalik: MAGNUS uchun test hamshira akkaunti + biriktirilgan vazifa.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MAGNUS = '7e4ab36d-a750-43f6-8870-dd90a0d2da50';
const REQ = 'b9403725-a091-402d-8e5c-eeff11f530d0';
const EMAIL = 'nurse@magnus.test';
const PASSWORD = 'Nurse!2026';

// 1) auth user (mavjud bo'lsa topamiz)
let userId;
const created = await admin.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
  user_metadata: { full_name: 'Aziza Hamshira' },
  app_metadata: { clinic_id: MAGNUS, role: 'nurse' },
});
if (created.error) {
  const { data: list } = await admin.auth.admin.listUsers();
  const found = list.users.find((u) => u.email === EMAIL);
  if (!found) throw created.error;
  userId = found.id;
  console.log('user mavjud:', userId);
} else {
  userId = created.data.user.id;
  console.log('user yaratildi:', userId);
}

// 2) trigger app_metadata'ni staff'ga qaytargan bo'lishi mumkin — qayta o'rnatamiz
await admin.auth.admin.updateUserById(userId, {
  app_metadata: { clinic_id: MAGNUS, role: 'nurse' },
});

// 3) profiles (trigger staff yaratgan) → nurse + clinic
await admin.from('profiles').upsert(
  { id: userId, email: EMAIL, full_name: 'Aziza Hamshira', role: 'nurse', clinic_id: MAGNUS, is_active: true },
  { onConflict: 'id' },
);

// 4) staff_profiles (position=nurse) — hamshira sifatida ko'rinishi uchun
const { data: sp } = await admin
  .from('staff_profiles')
  .select('id')
  .eq('clinic_id', MAGNUS)
  .eq('profile_id', userId)
  .maybeSingle();
if (!sp) {
  await admin.from('staff_profiles').insert({
    clinic_id: MAGNUS,
    profile_id: userId,
    first_name: 'Aziza',
    last_name: 'Hamshira',
    position: 'nurse',
    is_active: true,
  });
  console.log('staff_profiles yaratildi');
}

// 5) home_nurse_request'ni shu hamshiraga biriktiramiz
const { error: upErr } = await admin
  .from('home_nurse_requests')
  .update({
    assigned_nurse_profile_id: userId,
    assigned_at: new Date().toISOString(),
    status: 'assigned',
    quoted_price_uzs: 80000,
    sessions_per_day: 1,
    days_count: 3,
    updated_at: new Date().toISOString(),
  })
  .eq('id', REQ);
if (upErr) throw upErr;

console.log('✓ Tayyor. Login:', EMAIL, '/', PASSWORD, '| nurse profile:', userId);
