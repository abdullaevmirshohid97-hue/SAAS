#!/usr/bin/env node
/**
 * i18n audit — t('key') ishlatuvlarini barcha locale fayllar bilan solishtiradi.
 *
 * Usage: node scripts/i18n-audit.mjs
 *        node scripts/i18n-audit.mjs --fix       # tilkalardagi yo'q kalitlarga "" qo'shadi
 *        node scripts/i18n-audit.mjs --apps web-clinic,web-landing
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('.', import.meta.url).pathname.replace(/^\/([a-zA-Z]):/, '$1:'), '..');
const LOCALES_DIR = join(ROOT, 'packages', 'i18n', 'locales');
const APPS_DIR = join(ROOT, 'apps');

const argv = process.argv.slice(2);
const FIX = argv.includes('--fix');
const appsArg = argv.find((a) => a.startsWith('--apps='));
const APPS = appsArg
  ? appsArg.slice('--apps='.length).split(',')
  : readdirSync(APPS_DIR).filter((d) => statSync(join(APPS_DIR, d)).isDirectory());

const localeFiles = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));
const locales = Object.fromEntries(
  localeFiles.map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(LOCALES_DIR, f), 'utf8'))]),
);

// Walk source files to collect t('key') usages
const KEY_RE = /\bt\(\s*['"`]([a-zA-Z0-9_.\-]+)['"`]/g;
const usedKeys = new Set();

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.astro' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(tsx?|jsx?|astro|vue)$/.test(entry.name)) {
      const content = readFileSync(full, 'utf8');
      let m;
      while ((m = KEY_RE.exec(content))) usedKeys.add(m[1]);
    }
  }
}

for (const app of APPS) {
  const src = join(APPS_DIR, app, 'src');
  try {
    statSync(src);
    walk(src);
  } catch {
    // skip apps without src/
  }
}

console.log(`\nScanned ${APPS.length} apps, found ${usedKeys.size} unique t('key') calls\n`);

function getNested(obj, key) {
  return key.split('.').reduce((acc, k) => (acc && typeof acc === 'object' ? acc[k] : undefined), obj);
}

function setNested(obj, key, value) {
  const parts = key.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] == null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts.at(-1)] = value;
}

const report = {};
for (const loc of Object.keys(locales)) {
  const missing = [];
  for (const k of usedKeys) {
    const v = getNested(locales[loc], k);
    if (v === undefined || v === null || v === '') missing.push(k);
  }
  report[loc] = missing;
}

let totalMissing = 0;
for (const [loc, missing] of Object.entries(report)) {
  totalMissing += missing.length;
  console.log(`${loc.padEnd(10)} ${missing.length === 0 ? '✓ OK' : `${missing.length} missing`}`);
  if (missing.length > 0 && missing.length <= 30) {
    for (const k of missing) console.log(`   - ${k}`);
  } else if (missing.length > 30) {
    for (const k of missing.slice(0, 10)) console.log(`   - ${k}`);
    console.log(`   ... va ${missing.length - 10} ta boshqa`);
  }
}

if (FIX && totalMissing > 0) {
  for (const [loc, missing] of Object.entries(report)) {
    if (missing.length === 0) continue;
    for (const k of missing) setNested(locales[loc], k, '');
    writeFileSync(join(LOCALES_DIR, `${loc}.json`), JSON.stringify(locales[loc], null, 2) + '\n');
    console.log(`  → ${loc}.json: ${missing.length} ta bo'sh kalit qo'shildi`);
  }
  console.log('\n✓ Fix qilindi. Endi har lokalga matn yozish kerak.');
}

console.log(`\nJami: ${totalMissing} missing entries across ${Object.keys(locales).length} locales`);
process.exit(totalMissing > 0 && !FIX ? 1 : 0);
