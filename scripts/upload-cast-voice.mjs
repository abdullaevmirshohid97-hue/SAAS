#!/usr/bin/env node
// =============================================================================
// Clary Cast — yozib olingan navbat iboralarini platforma standartiga yuklash
// =============================================================================
// Papkadagi <kalit>.<ext> fayllarni 'cast-voice' bucket'iga `_default/` ostiga
// yuklaydi (barcha klinikalar TV'si shu ovozda chaqiradi; klinika o'zinikini
// yozsa — o'shanisi ustun). Kalitlar: packages/schemas/src/cast-voice.ts
// (p_patient, p_room, p_welcome, p_next, n1..n100, o1..o9/o10..o90/o100).
//
// Ovoz fayllari repoga QO'SHILMAYDI (repo ochiq) — papka diskda turadi.
// Bucket avval yaratilgan bo'lishi kerak: bash scripts/deploy-cast-voice.sh
//
// ISHLATISH:
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/upload-cast-voice.mjs <papka> [--scope _default] [--dry-run]
// =============================================================================
import { readdirSync, readFileSync } from 'node:fs';
import { extname, basename, join } from 'node:path';

const BUCKET = 'cast-voice';
// n1..n100 (11..99 qo'shma sonlar ixtiyoriy), o — faqat asosiy sonlar
const KEY_RE = /^(p_patient|p_room|p_welcome|p_next|n(?:[1-9]\d?|100)|o(?:[1-9]|[1-9]0|100))$/;
const MIME = {
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
};

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const scopeIdx = args.indexOf('--scope');
const scope = scopeIdx >= 0 ? args[scopeIdx + 1] : '_default';
const dryRun = args.includes('--dry-run');

const url = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!dir) {
  console.error('Papka berilmagan: node scripts/upload-cast-voice.mjs <papka>');
  process.exit(1);
}
if (!dryRun && (!url || !key)) {
  console.error('SUPABASE_URL va SUPABASE_SERVICE_ROLE_KEY kerak');
  process.exit(1);
}

const files = readdirSync(dir)
  .map((f) => ({ f, ext: extname(f).toLowerCase(), k: basename(f, extname(f)) }))
  .filter(({ ext, k }) => MIME[ext] && KEY_RE.test(k));
if (files.length === 0) {
  console.error(`Yuklanadigan fayl yo'q: ${dir}`);
  process.exit(1);
}

const headers = { Authorization: `Bearer ${key}`, apikey: key };

async function existing() {
  const res = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: scope, limit: 1000 }),
  });
  if (!res.ok) throw new Error(`Ro'yxat ${res.status}: ${await res.text()}`);
  return ((await res.json()) ?? []).map((o) => o.name);
}

const before = dryRun ? [] : await existing();
let ok = 0;
for (const { f, ext, k } of files) {
  const target = `${scope}/${k}${ext}`;
  // Shu kalitning boshqa formatdagi eski fayli (masalan .webm) qolmasin
  const stale = before.filter((n) => basename(n, extname(n)) === k && n !== `${k}${ext}`);
  if (dryRun) {
    console.log(`(sinov) ${f} → ${BUCKET}/${target}`);
    continue;
  }
  if (stale.length) {
    await fetch(`${url}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: stale.map((n) => `${scope}/${n}`) }),
    });
  }
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${target}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': MIME[ext], 'x-upsert': 'true' },
    body: readFileSync(join(dir, f)),
  });
  if (!res.ok) {
    console.error(`✗ ${f}: ${res.status} ${await res.text()}`);
    continue;
  }
  ok++;
  console.log(`✓ ${target}`);
}
if (!dryRun) console.log(`\n${ok}/${files.length} ta yuklandi → ${BUCKET}/${scope}/`);
