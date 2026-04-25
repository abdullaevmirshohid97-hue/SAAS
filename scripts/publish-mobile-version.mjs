#!/usr/bin/env node
/**
 * Publishes a new mobile app version to the `app_versions` table and the
 * landing CMS `download` entries.
 *
 * Usage:
 *   node scripts/publish-mobile-version.mjs \
 *     --app=patient-mobile \
 *     --channel=preview \
 *     --version=0.1.0-preview \
 *     --android-url=https://expo.dev/artifacts/eas/xxx.apk \
 *     --ios-url=https://testflight.apple.com/join/xxxxx
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}

const app = args.app ?? 'patient-mobile';
const channel = args.channel ?? 'preview';
const version = args.version;
const androidUrl = args['android-url'] ?? null;
const iosUrl = args['ios-url'] ?? null;
const force = String(args.force ?? 'false') === 'true';
const notes = args.notes ?? `Avtomatik build, kanal: ${channel}`;

if (!version) {
  console.error('Missing --version. Example: --version=0.1.0-preview');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Mark previous current as not current
const { error: clearErr } = await sb
  .from('app_versions')
  .update({ is_current: false })
  .eq('app', app)
  .eq('channel', channel);
if (clearErr) console.warn('clear current warn:', clearErr.message);

// Insert new version
const { error: insertErr } = await sb.from('app_versions').insert({
  app,
  channel,
  version,
  min_supported_version: version,
  force_update: force,
  is_current: true,
  download_url: androidUrl ?? iosUrl,
  release_notes_i18n: { 'uz-Latn': notes },
  metadata: { android_url: androidUrl, ios_url: iosUrl, channel },
});
if (insertErr) {
  console.error('insert failed:', insertErr.message);
  process.exit(1);
}
console.log(`✓ ${app}@${version} (${channel}) registered.`);

// Update landing CMS download entries (best-effort)
const updates = [];
if (androidUrl) {
  updates.push({
    key: 'download.android',
    data: { platform: 'android', url: androidUrl, version },
  });
}
if (iosUrl) {
  updates.push({
    key: 'download.ios',
    data: { platform: 'ios', url: iosUrl, version },
  });
}

for (const u of updates) {
  const { data: existing } = await sb
    .from('site_entries')
    .select('id, data')
    .eq('key', u.key)
    .maybeSingle();
  if (existing) {
    const merged = { ...(existing.data ?? {}), ...u.data };
    await sb.from('site_entries').update({ data: merged, status: 'published', published_at: new Date().toISOString() }).eq('id', existing.id);
    console.log(`✓ updated CMS ${u.key}`);
  } else {
    console.warn(`! CMS entry ${u.key} not found, skipping`);
  }
}

console.log('Done.');
