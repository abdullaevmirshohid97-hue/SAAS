#!/usr/bin/env node
// =============================================================================
// Clary v2 — Mobile build publisher
// After `eas build --profile preview` succeeds, call this script with the
// resulting APK URL + version to:
//   1. Upsert an app_versions row (app=mobile-android, channel=stable)
//   2. Sync the site_entries `download` card (platform=android) for /download
// Usage:
//   node scripts/publish-mobile-build.mjs --version 1.0.3 --url https://expo.dev/... \
//       [--size-mb 38] [--channel stable] [--force-update false] \
//       [--notes "Bug fixes"]
// =============================================================================
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    url: { type: 'string' },
    channel: { type: 'string', default: 'stable' },
    'size-mb': { type: 'string' },
    'force-update': { type: 'string', default: 'false' },
    notes: { type: 'string', default: '' },
    app: { type: 'string', default: 'mobile-android' },
    platform: { type: 'string', default: 'android' },
  },
});

if (!values.version || !values.url) {
  console.error('❌ --version and --url are required');
  process.exit(1);
}

const SUPABASE_URL = env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in .env.local');

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const version = values.version;
const url = values.url;
const channel = values.channel;
const forceUpdate = values['force-update'] === 'true';
const sizeMb = values['size-mb'] ? Number(values['size-mb']) : null;

async function upsertAppVersion() {
  const notes = values.notes
    ? {
        'uz-Latn': values.notes,
        ru: values.notes,
        en: values.notes,
      }
    : {
        'uz-Latn': `Android APK v${version}`,
        ru: `Android APK v${version}`,
        en: `Android APK v${version}`,
      };

  const { error } = await admin
    .from('app_versions')
    .upsert(
      {
        app: values.app,
        channel,
        version,
        min_supported_version: version,
        is_current: true,
        force_update: forceUpdate,
        download_url: url,
        release_notes_i18n: notes,
        metadata: { size_mb: sizeMb, platform: values.platform, released_via: 'eas-cli' },
        released_at: new Date().toISOString(),
      },
      { onConflict: 'app,channel,version' },
    );
  if (error) throw new Error(`app_versions upsert failed: ${error.message}`);
  console.log(`✓ app_versions updated for ${values.app} v${version}`);
}

async function upsertDownloadEntry() {
  const key = `download.${values.platform}`;
  const row = {
    key,
    kind: 'download',
    sort_order: values.platform === 'android' ? 1 : 10,
    is_published: true,
    content_i18n: {
      'uz-Latn': {
        title: values.platform === 'android' ? 'Clary Mobile (Android)' : `Clary ${values.platform}`,
        body:
          values.platform === 'android'
            ? 'Smartfon uchun Clary — offline rejim bilan ishlaydi va avtomatik yangilanadi.'
            : `Clary ${values.platform} build`,
      },
    },
    data: {
      platform: values.platform,
      version,
      size_mb: sizeMb,
      released: new Date().toISOString().slice(0, 10),
      url,
    },
  };
  const { error } = await admin
    .from('site_entries')
    .upsert(row, { onConflict: 'key' });
  if (error) throw new Error(`site_entries upsert failed: ${error.message}`);
  console.log(`✓ site_entries "${key}" refreshed`);
}

await upsertAppVersion();
await upsertDownloadEntry();
console.log('🎉 Mobile build published. /download will show it on next page load.');
