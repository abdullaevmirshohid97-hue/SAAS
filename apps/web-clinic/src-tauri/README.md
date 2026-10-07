# Clary Desktop (Tauri)

Windows desktop ilova. **0.2.0 dan boshlab interfeys serverdan yuklanadi**
(`https://app.clary.uz`): desktop — yupqa qobiq (oyna + native qo'shimchalar).
Native qo'shimchalar: **silent termal print** (USB/Windows, dialogsiz), brauzer
print-agent (127.0.0.1:7777), Google OAuth deep-link va imzolangan **auto-update**.

Barcha desktop xususiyati frontend'da `isTauri()` ([src/lib/platform.ts]) orqasida —
brauzerda hech narsa o'zgarmaydi.

## Yangilanishlar — ikki xil

| Nima o'zgardi | Nima qilinadi | Mijozda |
| --- | --- | --- |
| Web kod (sahifalar, funksiyalar) — **deyarli har doim** | Oddiy web deploy (`/var/www/app`) | 5 daqiqa ichida «Yangi versiya joylandi → Yangilash» banneri (brauzer **va** desktop). Bitta tugma — sahifa qayta yuklanadi |
| Desktop qobig'i (Rust/printer, `tauri.conf.json`, ruxsatlar, ikonka) — kamdan-kam | `scripts/desktop-release.ps1 -Upload` | 30 daqiqa ichida «Clary desktop X tayyor → Yangilash» — yuklab, o'rnatib, qayta ishga tushadi |

Qanday ishlaydi:
- Har web build `dist/version.json` (`{ id, sha, built_at }`) chiqaradi va o'z `__APP_BUILD__`ini
  biladi ([vite.config.ts](../vite.config.ts)). Banner ([app-update-banner.tsx](../src/components/app-update-banner.tsx))
  serverdagi `/version.json` bilan solishtiradi.
- Qobiq: `clary.uz/download/latest.json` (ed25519 imzo) — `tauri-plugin-updater`.
- [shell/](shell/) — lokal boshlang'ich sahifa: internet bo'lsa `app.clary.uz`ga o'tadi, bo'lmasa
  «Internet aloqasi yo'q» + avtomatik qayta urinish.
- Ruxsatlar: `capabilities/default.json` — `remote.urls = https://app.clary.uz/*`; printer buyruqlari
  `build.rs` app-manifest orqali (`allow-print-thermal` …). Boshqa domen IPC'ga yetolmaydi.
- Oyna faqat `app.clary.uz`da qoladi — boshqa havolalar tizim brauzerida (`nav_guard`, [src/lib.rs](src/lib.rs)).
- `app.clary.uz` CSP'sida `ipc: http://ipc.localhost` bo'lishi SHART (infra/caddy/Caddyfile).
- 0.1.x → 0.2.0: kelib chiqish (origin) o'zgargani uchun bir marta qayta login so'raladi.

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
pnpm desktop:build    # prod .exe (target\release\bundle\nsis\) — imzo uchun 5-bo'limdagi skript
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
- `createUpdaterArtifacts: true` → build NSIS `.exe` + `.sig` + `latest.json` yaratadi.

> ⚠ **Imzo (parol) nuance'i:** `--ci` bilan yaratilgan parolsiz kalitda `tauri build`
> imzo bosqichida parol so'rab **qotib qoladi** (non-interaktiv shell'da). Ikki yo'l:
> (a) kalitni **parol bilan** yarating (`tauri signer generate -p "<parol>"`) va build'da
> `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` env bering; yoki
> (b) `.exe`ni alohida imzolang (parolsiz kalit uchun bo'sh parolni `--password=` shaklida bering — PowerShell `""` tokenini tushirib yuboradi):
> `pnpm exec tauri signer sign -f $env:USERPROFILE\.clary\updater.key "--password=" "<...>\Clary_0.1.0_x64-setup.exe"`

## 5. Reliz va tarqatish

**Bir buyruq** (Windows, repo ildizida):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\desktop-release.ps1 -Version 0.2.1 -Notes "Nima o'zgardi" -Upload
```

Skript: versiyani (`tauri.conf.json` + `Cargo.toml`) yangilaydi → kalit parolini **build'dan oldin**
sinov imzosi bilan tekshiradi → `tauri build` (imzo bilan) → `latest.json` yozadi → doimiy nomli
`Clary_x64-setup.exe` nusxasini yaratadi → `scp` bilan `/var/www/download/`ga yuklaydi
(`latest.json` oxirida). Parol `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` env'dan yoki so'raladi.
Faqat yuklash: `-SkipBuild -Upload`.

**Server:** host Caddy'dagi mavjud `@clary_dl path /download/Clary_*.exe …` handler'i
(0.1.1 dan beri jonli) yangi fayllarni ham ushlaydi — doimiy nom `Clary_x64-setup.exe` ataylab shu
naqshga mos. Ixtiyoriy yaxshilash: [infra/caddy/Caddyfile](../../../infra/caddy/Caddyfile) dagi
`@clary_dl` bloki (latest.json/doimiy .exe `no-cache`). `app.clary.uz` CSP'si hostda qo'llangan
bo'lsa — unga `ipc: http://ipc.localhost` qo'shilishi SHART. `admin off` bo'lgani uchun
`caddy reload` ishlamaydi → `systemctl restart caddy` (shu Caddy boshqa ilovalarni ham yuritadi —
tinch paytda).

**Tekshirish:**

```bash
curl -I https://clary.uz/download/Clary_x64-setup.exe   # 200
curl    https://clary.uz/download/latest.json        # manifest
curl    https://app.clary.uz/version.json            # web build id
```

- Yuklab olish havolasi doimiy: `https://clary.uz/download/Clary_x64-setup.exe` — clary.uz/download
  sahifasi `latest.json` bo'lsa tugmani o'zi ko'rsatadi; ilovada: Sozlamalar → Klinika → «Clary desktop».
- OS code-signing yo'q — SmartScreen'da «Batafsil → Baribir ishga tushirish» (bir marta).
  Updater ed25519 imzosi alohida va majburiy.

---

## Xavfsizlik (tekshirish ro'yxati)

- Interfeys faqat https://app.clary.uz dan; IPC ruxsati faqat shu domen + lokal boshlang'ich sahifaga.
- Lokal boshlang'ich sahifa CSP'si `tauri.conf.json`da (faqat o'zi + app.clary.uz); interfeys CSP'si — Caddy (`app.clary.uz`).
- Minimal capabilities (`capabilities/default.json`) — fs/shell YO'Q (process — faqat yangilanishdan keyin qayta ishga tushirish).
- Tashqi havolalar tizim brauzerida (`tauri-plugin-opener`).
- Bundlda sir yo'q — faqat publishable Supabase anon key.
- Updater ed25519-imzolangan; maxfiy kalit repodan tashqarida.
- Release'da devtools o'chiq (`windows_subsystem = "windows"`).
