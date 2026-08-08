// =============================================================================
// Clary brend asset generatori — TIPOGRAFIK (v2, 2026-08-08)
// =============================================================================
// O'ZGARISH: ilgari brend `clary.logo.jpg` rasmidan (metall wordmark) kesib
// olinardi. Endi brend BUTUNLAY KODDAN tug'iladi: "CLARY" so'zi texnik
// (DIN uslubidagi) shriftda yoziladi. Ya'ni:
//   - manba rasm yo'qolsa ham brend qayta tiklanadi;
//   - o'lcham/rang/harf oralig'i shu yerda bir joyda boshqariladi;
//   - hech qanday raster "metall" tekstura yo'q — har o'lchamda toza.
//
// TIZIM (2 daraja):
//   1. Wordmark "CLARY"  — keng kontekst: UI sarlavha, OG rasm, splash.
//   2. Monogramma "C"    — kvadrat ikonlar (favicon 16px da 5 harf o'qilmaydi).
//      Ikkalasi ham AYNI shrift va ayni ohangda — bir tizim.
//
// Ishga tushirish:  node scripts/brand/gen-brand-assets.mjs   (repo ildizidan)
// =============================================================================
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
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

// --- Brend konstantalari -----------------------------------------------------
const INK = '#0A0A0A'; // deyarli qora fon
const INK_2 = '#141821'; // gradient uchun sovuqroq to'q ton
const PAPER = '#FFFFFF'; // harflar
const ACCENT = '#2563EB'; // brend ko'k — faqat nozik urg'u chiziqlari uchun

// Texnik/hi-tech shrift zinapoyasi. Bahnschrift (Windows, DIN asosida) —
// asosiy; qolganlari boshqa tizimlarda mos tushishi uchun.
const FONT = "Bahnschrift, 'DIN Next', 'Segoe UI Variable Display', 'Segoe UI', Arial, sans-serif";

// Cap-height ≈ 0.71em (DIN oilasi). Matnni vertikal MARKAZLASH uchun baseline
// markazdan shuncha pastga suriladi. `dominant-baseline` ishlatilmaydi —
// librsvg (sharp ichida) uni ishonchli qo'llamaydi.
const CAP_RATIO = 0.71;
const baselineFor = (centerY, fontSize) => centerY + (fontSize * CAP_RATIO) / 2;

const WEB_APPS = ['web-landing', 'web-clinic', 'web-admin', 'web-patient'];

/** SVG matn bo'lagi (bitta joyda — barcha assetlar bir xil ohangda chiqsin). */
function textEl({ x, y, size, text, fill = PAPER, tracking, weight = 700, anchor = 'middle' }) {
  const ls = tracking ?? size * 0.1;
  // MUHIM: letter-spacing oxirgi harfdan keyin ham qo'shiladi va matnni
  // markazdan chapga suradi. Yarim oraliqqa surib kompensatsiya qilamiz.
  const dx = anchor === 'middle' ? ls / 2 : 0;
  return (
    `<text x="${x + dx}" y="${y}" text-anchor="${anchor}" font-family="${FONT}" ` +
    `font-size="${size}" font-weight="${weight}" letter-spacing="${ls}" fill="${fill}">${text}</text>`
  );
}

const svgBuf = (s) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${s}</svg>`);

/**
 * SVG → PNG, ANIQ o'lchamda.
 * TUZOQ: sharp'da `density` SVG'ni kattalashtiradi (density/72 barobar), ya'ni
 * width="16" + density:400 → 89px fayl. Shu sabab har doim `.resize()` bilan
 * majburiy o'lchamga tushiramiz. Density esa oraliq rasm ~2048px atrofida
 * bo'ladigan qilib tanlanadi: kichik ikonlar uchun kuchli supersampling
 * (harf chetlari toza), kattalar uchun ortiqcha xotira sarflanmaydi.
 */
async function raster(svg, w, h) {
  const density = Math.min(600, Math.max(96, Math.round((72 * 2048) / Math.max(w, h))));
  return sharp(svgBuf(svg), { density })
    .resize(Math.round(w), Math.round(h), { fit: 'fill' })
    .png()
    .toBuffer();
}

/**
 * Matnni shaffof fonda chizib, ATROFINI KESIB tashlaydi — natijada aniq
 * harf qutisi (bbox) qoladi.
 *
 * Nega shunday: matnni `text-anchor`/baseline hisobi bilan markazlash shrift
 * metrikasiga tayanadi va har shriftda 2-5% siljish beradi (birinchi urinishda
 * "C" ko'zga tashlanadigan darajada o'ngga qochgan edi). Piksel bo'yicha
 * kesib, keyin `gravity: center` bilan joylash — shriftdan MUSTAQIL va har
 * doim aniq markazda.
 */
async function glyphBuffer(text, targetH, tracking = 0) {
  const fs = Math.round(targetH * 3); // katta chizib, keyin kichraytiramiz
  const pad = Math.round(fs * 0.6);
  const w = Math.round(fs * (text.length + 1) * 0.9 + pad * 2);
  const h = Math.round(fs * 2 + pad);
  const svg =
    `width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    textEl({
      x: w / 2,
      y: h / 2 + fs * 0.35,
      size: fs,
      text,
      tracking: tracking * 3,
    });
  const big = await sharp(svgBuf(svg), { density: 96 }).png().toBuffer();
  // trim — shaffof chetlarni olib tashlaydi (aniq harf qutisi)
  const trimmed = await sharp(big).trim({ threshold: 1 }).png().toBuffer();
  const m = await sharp(trimmed).metadata();
  const scale = targetH / (m.height ?? targetH);
  return sharp(trimmed)
    .resize({ height: Math.round(targetH), width: Math.round((m.width ?? 1) * scale) })
    .png()
    .toBuffer();
}

/**
 * Kvadrat ilova ikoni — to'q yumaloq kvadratda oq "C" monogrammasi.
 * Kichik o'lchamlarda (≤48) burchak radiusi va chekka kichrayadi, aks holda
 * favicon "yumaloq nuqta"ga aylanib, harf o'qilmay qoladi.
 */
async function monogramIcon(size) {
  const r = Math.round(size * (size <= 48 ? 0.16 : 0.22));
  // Harf balandligi plitkaning 52% (kichiklarda 62% — 16px da o'qilishi uchun).
  const glyphH = Math.round(size * (size <= 48 ? 0.62 : 0.52));
  const tile = await raster(
    `width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${INK}"/>`,
    size,
    size,
  );
  const glyph = await glyphBuffer('C', glyphH);
  return sharp(tile)
    .composite([{ input: glyph, gravity: 'center' }])
    .png()
    .toBuffer();
}

/** Gorizontal "CLARY" wordmark — to'q yumaloq chipda (tashqi foydalanish uchun). */
async function wordmarkChip(height) {
  const glyphH = Math.round(height * 0.33); // cap-height chip balandligining 1/3
  const glyph = await glyphBuffer('CLARY', glyphH, glyphH * 0.2);
  const gm = await sharp(glyph).metadata();
  const padX = Math.round(height * 0.36);
  const width = (gm.width ?? glyphH * 4) + padX * 2;
  const r = Math.round(height * 0.26);
  const chip = await raster(
    `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<rect width="${width}" height="${height}" rx="${r}" ry="${r}" fill="${INK}"/>`,
    width,
    height,
  );
  return sharp(chip)
    .composite([{ input: glyph, gravity: 'center' }])
    .png()
    .toBuffer();
}

/** Shaffof fonli oq wordmark (splash/adaptive kabi to'q fonlar uchun). */
async function wordmarkPlain(width) {
  // Kenglikdan kelib chiqib cap-height ni tanlaymiz, so'ng aniq kenglikka
  // moslashtiramiz (glyphBuffer balandlik bo'yicha ishlaydi).
  const probe = await glyphBuffer('CLARY', 100, 20);
  const pm = await sharp(probe).metadata();
  const h = Math.round((100 * width) / (pm.width ?? width));
  return glyphBuffer('CLARY', h, h * 0.2);
}

/** Kvadrat "C" plitka (vektor) — logo.svg, brend kiti ikoni, favicon.svg. */
function markSvg(S = 64) {
  const fs = S * 0.6;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" role="img" aria-label="Clary">` +
    `<rect width="${S}" height="${S}" rx="${Math.round(S * 0.22)}" fill="${INK}"/>` +
    textEl({ x: S / 2, y: baselineFor(S / 2, fs), size: fs, text: 'C', tracking: 0 }) +
    `</svg>`
  );
}

/**
 * Wordmark (vektor) — `currentColor` bilan, ya'ni joylashtirilgan joyning
 * rangini oladi (och/to'q fon — ikkalasida ham ishlaydi).
 */
function wordmarkSvg() {
  const W = 240;
  const H = 56;
  const fs = 30;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="CLARY">` +
    `<rect x="0" y="${H / 2 - 17}" width="4" height="34" rx="2" fill="${ACCENT}"/>` +
    textEl({
      x: 18,
      y: baselineFor(H / 2, fs),
      size: fs,
      text: 'CLARY',
      tracking: fs * 0.22,
      fill: 'currentColor',
      weight: 600,
      anchor: 'start',
    }) +
    `</svg>`
  );
}

/** OG / ijtimoiy-preview (1200×630) — wordmark + tavsif + urg'u chizig'i. */
async function ogImage() {
  const W = 1200;
  const H = 630;
  const fs = 132;
  const tracking = fs * 0.14;
  return raster(
    `width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<defs><linearGradient id="bg" x1="0" y1="0" x2="${W}" y2="${H}" gradientUnits="userSpaceOnUse">` +
        `<stop offset="0%" stop-color="${INK}"/><stop offset="100%" stop-color="${INK_2}"/></linearGradient></defs>` +
        `<rect width="${W}" height="${H}" fill="url(#bg)"/>` +
        textEl({
          x: 120,
          y: 300,
          size: fs,
          text: 'CLARY',
          tracking,
          anchor: 'start',
        }) +
        `<rect x="122" y="348" width="240" height="5" rx="2.5" fill="${ACCENT}"/>` +
        `<text x="120" y="452" font-family="${FONT}" font-size="38" font-weight="600" fill="#93C5FD">Klinika boshqaruv platformasi</text>` +
        `<text x="120" y="506" font-family="${FONT}" font-size="27" font-weight="400" fill="#94A3B8">Bemorlar · Navbat · Diagnostika · Dorixona · Kassa</text>`,
    W,
    H,
  );
}

async function main() {
  console.log('Clary brend generatori — tipografik (manba rasm KERAK EMAS)\n');

  // --- Web ikonlari: har 4 app public/ ---
  const webSizes = {
    'favicon-16.png': 16,
    'favicon-32.png': 32,
    'apple-touch-icon.png': 180,
    'icon-192.png': 192,
    'icon-512.png': 512,
  };
  const svgText = markSvg();
  for (const app of WEB_APPS) {
    const pub = path.join(ROOT, 'apps', app, 'public');
    mkdirSync(pub, { recursive: true });
    for (const [name, size] of Object.entries(webSizes)) {
      writeFileSync(path.join(pub, name), await monogramIcon(size));
    }
    writeFileSync(path.join(pub, 'logo.svg'), svgText);
    writeFileSync(path.join(pub, 'clary-wordmark.png'), await wordmarkChip(160));
    console.log(`✓ ${app}/public — 5 ikon + logo.svg + clary-wordmark.png`);
  }

  // --- Brend kiti (packages/brand) — dizayner/tashqi foydalanish uchun ---
  // Ilgari bu yerda eskirgan "CLARY CARE" gradient logotipi turardi (hech
  // qayerda ishlatilmasdi, lekin adashtirardi). Endi u ham shu generatordan.
  const brandPkg = path.join(ROOT, 'packages/brand');
  if (existsSync(brandPkg)) {
    writeFileSync(path.join(brandPkg, 'logo.svg'), wordmarkSvg());
    writeFileSync(path.join(brandPkg, 'wordmark.svg'), wordmarkSvg());
    writeFileSync(path.join(brandPkg, 'icon.svg'), markSvg(1024));
    writeFileSync(path.join(brandPkg, 'favicon.svg'), markSvg(32));
    console.log('✓ packages/brand — logo/wordmark/icon/favicon.svg');
  }

  // --- OG rasm — faqat landing ---
  writeFileSync(path.join(ROOT, 'apps/web-landing/public/og-default.png'), await ogImage());
  console.log('✓ web-landing/og-default.png');

  // --- Tauri manbasi (1024 kvadrat) ---
  writeFileSync(path.join(ROOT, 'scripts/brand/icon-1024.png'), await monogramIcon(1024));
  console.log('✓ scripts/brand/icon-1024.png (Tauri manbasi)');

  // --- Mobil (Expo) ---
  const mob = path.join(ROOT, 'apps/mobile/assets');
  if (existsSync(mob)) {
    writeFileSync(path.join(mob, 'icon.png'), await monogramIcon(1024));
    writeFileSync(path.join(mob, 'favicon.png'), await monogramIcon(48));

    // Adaptive foreground — shaffof fonda oq "C" (fon rangi app.json'da).
    // Android markaziy doiraga kesadi → harf 60% maydonda tursin.
    const fgSize = 1024;
    const fgFs = fgSize * 0.34;
    writeFileSync(
      path.join(mob, 'adaptive-icon.png'),
      await raster(
        `width="${fgSize}" height="${fgSize}" viewBox="0 0 ${fgSize} ${fgSize}">` +
          textEl({
            x: fgSize / 2,
            y: baselineFor(fgSize / 2, fgFs),
            size: fgFs,
            text: 'C',
            tracking: 0,
          }),
        fgSize,
        fgSize,
      ),
    );

    // Bildirishnoma ikoni — Android uni siluet qiladi, shuning uchun sof oq.
    const notif = path.join(mob, 'notification-icon.png');
    if (existsSync(notif)) {
      const nS = 256;
      writeFileSync(
        notif,
        await raster(
          `width="${nS}" height="${nS}" viewBox="0 0 ${nS} ${nS}">` +
            textEl({
              x: nS / 2,
              y: baselineFor(nS / 2, nS * 0.62),
              size: nS * 0.62,
              text: 'C',
              tracking: 0,
            }),
          nS,
          nS,
        ),
      );
    }

    // Splash — wordmark markazda, to'q fon.
    const splashWm = await wordmarkPlain(760);
    writeFileSync(
      path.join(mob, 'splash.png'),
      await sharp({ create: { width: 1242, height: 2436, channels: 4, background: INK } })
        .composite([{ input: splashWm, gravity: 'center' }])
        .png()
        .toBuffer(),
    );
    console.log('✓ apps/mobile/assets — icon/favicon/adaptive/notification/splash');
  }

  console.log('\nTayyor ✅  (Tauri ikonlari: pnpm tauri icon scripts/brand/icon-1024.png)');
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
