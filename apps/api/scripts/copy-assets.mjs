// =============================================================================
// src/assets → dist/assets (build'dan keyin)
// =============================================================================
// Nega alohida skript: nest-cli "assets" + "deleteOutDir" birikmasi ishonchsiz
// ishladi — bir build'da fayllar ko'chdi, keyingisida yo'q va prod'da PDF
// yasashda ENOENT bo'ldi (dist/assets/fonts/Roboto-Regular.ttf). Bu qadam
// build'dan KEYIN ishlaydi, shuning uchun natija aniq: fayl bor yoki build
// yiqiladi.
// =============================================================================
import { cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src', 'assets');
const dest = join(root, 'dist', 'assets');

if (!existsSync(src)) {
  console.log('[copy-assets] src/assets yo‘q — o‘tkazib yuborildi');
  process.exit(0);
}

cpSync(src, dest, { recursive: true });

// Tasdiqlash: bo'sh nusxa jimgina o'tib ketmasin.
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p.slice(dest.length + 1));
  }
};
walk(dest);

if (files.length === 0) {
  console.error('[copy-assets] XATO: dist/assets bo‘sh qoldi');
  process.exit(1);
}
console.log(`[copy-assets] ${files.length} ta fayl ko‘chirildi: ${files.join(', ')}`);
