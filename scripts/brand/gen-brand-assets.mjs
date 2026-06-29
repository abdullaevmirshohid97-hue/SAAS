// =============================================================================
// Clary brend asset generatori (takrorlanuvchi).
// Manba:  apps/web-landing/public/brand/clary.logo.jpg  (kumush wordmark, qora fon)
// Chiqish: 4 web app public/ (square dark ikonlar + logo.svg), Tauri manba 1024,
//          mobil assets (icon/adaptive/splash/favicon).
// Ishga tushirish:  node scripts/brand/gen-brand-assets.mjs   (repo ildizidan)
//
// 2 qatlamli brend: Tier-1 app icon = metall-on-qora (bu skript); Tier-2 UI mark
// = vektor "C" (ClaryLogo/BrandLogo komponentlarida, bu skriptda emas).
// =============================================================================
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch {
  // pnpm: ildizda hoisted emas — .pnpm yo'lidan
  sharp = require(path.resolve('node_modules/.pnpm/sharp@0.33.5/node_modules/sharp'));
}

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'apps/web-landing/public/brand/clary.logo.jpg');
if (!existsSync(SRC)) {
  console.error('Manba topilmadi:', SRC);
  process.exit(1);
}

const DARK = '#18181b';
const CRESCENT = 'M18.73 4.97 A12 12 0 1 0 18.73 27.03 A11.5 11.5 0 0 1 18.73 4.97 Z';
const LOGO_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">` +
  `<rect width="32" height="32" rx="8" fill="${DARK}"/>` +
  `<path fill="#ffffff" d="${CRESCENT}"/></svg>`;
// Vektor "C" oq, transparent (mobil adaptive foreground uchun)
const C_WHITE_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">` +
  `<path fill="#ffffff" d="${CRESCENT}"/></svg>`;

const WEB_APPS = ['web-landing', 'web-clinic', 'web-admin', 'web-patient'];

let TRIMMED; // metall wordmark, qora chetlarsiz

async function squareIcon(size) {
  const pad = size <= 48 ? 0.06 : 0.16;
  const innerW = Math.round(size * (1 - pad * 2));
  const wm = await sharp(TRIMMED)
    .resize({ width: innerW, height: Math.round(innerW * 0.6), fit: 'inside' })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: DARK } })
    .composite([{ input: wm, gravity: 'center' }])
    .png()
    .toBuffer();
}

// Gorizontal metall wordmark — to'q yumaloq "chip" ichida (chetlari shaffof).
// Ilova UI sarlavhalarida (sidebar/nav/login) ClaryLogo orqali ishlatiladi:
// och/to'q temada ham premium "metall-on-qora" ko'rinishi saqlanadi.
async function wordmarkChip(height) {
  // Manba sof qora fonli → chip ham SOF QORA: wordmark foni chip bilan
  // muammosiz qo'shiladi (seam yo'q), metall logo qora yumaloq chipda "suzadi".
  const padX = Math.round(height * 0.3);
  const padY = Math.round(height * 0.26);
  const innerH = height - padY * 2;
  const wm = await sharp(TRIMMED).resize({ height: innerH, fit: 'inside' }).png().toBuffer();
  const meta = await sharp(wm).metadata();
  const width = (meta.width ?? innerH) + padX * 2;
  const r = Math.round(height * 0.26);
  const bg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="${width}" height="${height}" rx="${r}" ry="${r}" fill="#000000"/></svg>`,
  );
  return sharp(bg).composite([{ input: wm, gravity: 'center' }]).png().toBuffer();
}

async function main() {
  TRIMMED = await sharp(SRC).trim({ threshold: 24 }).toBuffer();
  const tm = await sharp(TRIMMED).metadata();
  console.log(`Manba trimmed: ${tm.width}x${tm.height}`);

  // Web ikonlari — har 4 app public/
  const webSizes = { 'favicon-16.png': 16, 'favicon-32.png': 32, 'apple-touch-icon.png': 180, 'icon-192.png': 192, 'icon-512.png': 512 };
  for (const app of WEB_APPS) {
    const pub = path.join(ROOT, 'apps', app, 'public');
    mkdirSync(pub, { recursive: true });
    for (const [name, size] of Object.entries(webSizes)) {
      writeFileSync(path.join(pub, name), await squareIcon(size));
    }
    writeFileSync(path.join(pub, 'logo.svg'), LOGO_SVG);
    writeFileSync(path.join(pub, 'clary-wordmark.png'), await wordmarkChip(160));
    console.log(`✓ ${app}/public — 5 ikon + logo.svg + clary-wordmark.png`);
  }

  // Tauri manba (1024 kvadrat)
  const brandDir = path.join(ROOT, 'scripts/brand');
  writeFileSync(path.join(brandDir, 'icon-1024.png'), await squareIcon(1024));
  console.log('✓ scripts/brand/icon-1024.png (Tauri manba)');

  // Mobil (Expo) assets
  const mob = path.join(ROOT, 'apps/mobile/assets');
  if (existsSync(mob)) {
    writeFileSync(path.join(mob, 'icon.png'), await squareIcon(1024));
    writeFileSync(path.join(mob, 'favicon.png'), await squareIcon(48));
    // adaptive foreground — oq C, transparent (backgroundColor app.json'da DARK bo'ladi)
    const fg = await sharp(Buffer.from(C_WHITE_SVG), { density: 512 }).resize(432, 432, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    writeFileSync(path.join(mob, 'adaptive-icon.png'),
      await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: fg, gravity: 'center' }]).png().toBuffer());
    // splash — logo markazda, qora fon
    const splashWm = await sharp(TRIMMED).resize({ width: 720, fit: 'inside' }).png().toBuffer();
    writeFileSync(path.join(mob, 'splash.png'),
      await sharp({ create: { width: 1242, height: 2436, channels: 4, background: '#0A0A0A' } })
        .composite([{ input: splashWm, gravity: 'center' }]).png().toBuffer());
    console.log('✓ apps/mobile/assets — icon/favicon/adaptive/splash');
  }

  console.log('\\nTayyor ✅');
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
