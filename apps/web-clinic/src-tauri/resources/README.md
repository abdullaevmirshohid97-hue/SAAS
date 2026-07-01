# Tauri bundle resources — SumatraPDF (silent A4 print)

Faza 1 (A4 silent print) `print_pdf` buyrug'i **SumatraPDF.exe** ni ishlatadi (Windows'da
dialogsiz PDF chop etish uchun — POS standarti, bepul, ~5 MB).

## Kerak: `SumatraPDF.exe` ni SHU papkaga qo'ying

1. Yuklab oling (rasmiy, portable versiya):
   https://www.sumatrapdfreader.org/download-free-pdf-viewer
   → **"SumatraPDF ... 64-bit portable"** (bitta `.exe` fayl).
2. Faylni **`SumatraPDF.exe`** deb nomlab, aynan shu papkaga joylang:
   ```
   apps/web-clinic/src-tauri/resources/SumatraPDF.exe
   ```
3. Desktop build:
   ```
   pnpm --filter @clary/web-clinic tauri build
   ```
   (yoki lokal sinov: `pnpm --filter @clary/web-clinic desktop:dev`)

⚠️ Bu fayl bo'lmasa `tauri build` **XATO beradi** (tauri.conf.json `bundle.resources` uni talab qiladi).
`SumatraPDF.exe` git'ga commit qilinmaydi (binar; `.gitignore`da) — har build muhitida bir marta qo'yiladi.

## Nega SumatraPDF?
- Windows'da PDF'ni tanlangan printerga **silent** (`-print-to "<printer>" -silent`) chiqaradi — hech qanday viewer/dialog ochilmaydi.
- macOS/Linux'da `print_pdf` `lp -d` (CUPS) ishlatadi — SumatraPDF shart emas.

## Litsenziya
SumatraPDF — GPLv3 (portable exe alohida process sifatida chaqiriladi, statik linklanmaydi).
