# Clary Desktop (Tauri)

`web-clinic` (React+Vite) ilovasini Windows desktop ilovaga o'raydi. Brauzerdagi
clary.uz **tegilmaydi** — desktop bir xil prod build'ni ishlatadi va `api.clary.uz`ga
ulanadi. Native qo'shimchalar: **silent termal print** (USB/Windows, dialogsiz) +
imzolangan **auto-update**.

Barcha desktop xususiyati frontend'da `isTauri()` ([src/lib/platform.ts]) orqasida —
brauzerda hech narsa o'zgarmaydi.

---

## 1. Bir martalik toolchain (Windows)

Bu mashinada **Rust va MSVC C++ Build Tools YO'Q** — build uchun kerak:

```powershell
# Rust (rustup)
winget install Rustlang.Rustup
# MSVC C++ Build Tools (linker) — Tauri Windows uchun majburiy (~3-7 GB)
winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.Windows11SDK.22621"
# yangi terminal oching, so'ng:
rustup default stable-x86_64-pc-windows-msvc
```

WebView2 runtime allaqachon o'rnatilgan (Win11). Tauri CLI (`@tauri-apps/cli`)
allaqachon devDependency.

## 2. Ikonkalar (build'dan oldin majburiy)

`tauri.conf.json` `icons/` ga ishora qiladi — ularni mavjud logodan generatsiya qiling:

```powershell
cd apps/web-clinic
# manba PNG (kamida 512x512). public/logo.svg ni PNG ga aylantiring yoki tayyor PNG bering:
pnpm tauri icon path\to\logo-512.png
```

## 3. Ishga tushirish / build

```powershell
cd apps/web-clinic
pnpm desktop:dev      # dev (vite + tauri)
pnpm desktop:build    # prod .msi/.exe (target\release\bundle\nsis\)
```

> ⚠ Birinchi `cargo build` da `src/printing.rs` dagi `send_raw_to_printer()` —
> `printers` crate API'siga bog'liq. Versiya farq qilsa FAQAT shu funksiyani moslang
> (qolgan ESC/POS kod o'zgarmaydi).

## 4. Imzolangan auto-update (Bosqich 2)

```powershell
# kalit-juftini yarating (maxfiy kalitni SIR saqlang, repoga QO'YMANG)
pnpm tauri signer generate -w %USERPROFILE%\.clary\updater.key
```

- Chiqqan **ochiq kalitni** `tauri.conf.json` → `plugins.updater.pubkey` ga qo'ying
  (hozir `REPLACE_WITH_TAURI_SIGNER_PUBLIC_KEY`).
- Build paytida maxfiy kalitni env orqali bering:
  `$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $env:USERPROFILE\.clary\updater.key -Raw`
  (parol bo'lsa `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).
- `createUpdaterArtifacts: true` → build `.msi` + `.sig` + `latest.json` yaratadi.

## 5. Tarqatish (Caddy)

- `clary-setup.msi`, `latest.json`, `.sig` ni serverga: `/var/www/downloads/`.
- Caddy `clary.uz/download/*` ni statik beradi (HTTPS). SHA-256 checksum e'lon qiling.
- Klinika `.msi`ni yuklab o'rnatadi; keyin ilova `latest.json`dan **avto-yangilanadi**.
- Boshida ilova OS code-signing'siz — SmartScreen ogohlantirishini onboarding'da
  bir marta "Run anyway" bilan o'tasiz. (Updater imzosi — bu OS code-signing'dan
  alohida va majburiy.)

---

## Xavfsizlik (tekshirish ro'yxati)
- Faqat lokal bundlangan asset yuklanadi (remote URL emas).
- Qattiq CSP `tauri.conf.json`da — `connect-src` faqat api.clary.uz / supabase / posthog.
- Minimal capabilities (`capabilities/default.json`) — fs/shell/process YO'Q.
- Tashqi havolalar tizim brauzerida (`tauri-plugin-opener`).
- Bundlda sir yo'q — faqat publishable Supabase anon key.
- Updater ed25519-imzolangan; maxfiy kalit repodan tashqarida.
- Release'da devtools o'chiq (`windows_subsystem = "windows"`).
