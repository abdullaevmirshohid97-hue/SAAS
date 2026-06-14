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
- `createUpdaterArtifacts: true` → build NSIS `.exe` + `.sig` + `latest.json` yaratadi.

> ⚠ **Imzo (parol) nuance'i:** `--ci` bilan yaratilgan parolsiz kalitda `tauri build`
> imzo bosqichida parol so'rab **qotib qoladi** (non-interaktiv shell'da). Ikki yo'l:
> (a) kalitni **parol bilan** yarating (`tauri signer generate -p "<parol>"`) va build'da
> `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` env bering; yoki
> (b) `.exe`ni alohida imzolang (parolsiz kalit uchun bo'sh parolni `--password=` shaklida bering — PowerShell `""` tokenini tushirib yuboradi):
> `pnpm exec tauri signer sign -f $env:USERPROFILE\.clary\updater.key "--password=" "<...>\Clary_0.1.0_x64-setup.exe"`

## 5. Tarqatish (Caddy)

Artefaktlar (build'dan): `apps/web-clinic/src-tauri/target/release/bundle/nsis/`
→ `Clary_0.1.0_x64-setup.exe`, `Clary_0.1.0_x64-setup.exe.sig`, `latest.json`.

**1) Serverga yuklash** (`/var/www/download/` — landing `/var/www/app`dan alohida):
```bash
# serverda papka
mkdir -p /var/www/download
# lokal build natijasidan yuklash (scp yoki qulay usul bilan)
scp Clary_0.1.0_x64-setup.exe      SERVER:/var/www/download/
scp Clary_0.1.0_x64-setup.exe.sig  SERVER:/var/www/download/
scp latest.json                    SERVER:/var/www/download/
```

**2) Caddyfile** — `clary.uz` blokiga, **catch-all (landing) handler'dan OLDIN** qo'shing.
Astro `/download` SAHIFASI bilan to'qnashmaydi, chunki bu aniq fayl yo'llarini ushlaydi:
```caddy
clary.uz {
    # Desktop yuklab olish fayllari (Astro /download sahifasidan oldin turishi shart)
    @clary_dl path /download/Clary_*.exe /download/latest.json /download/*.sig
    handle @clary_dl {
        root * /var/www          # /download/<fayl> → /var/www/download/<fayl>
        header /download/latest.json Cache-Control "no-cache"
        file_server
    }

    # ... mavjud landing konfiguratsiyasi (root /var/www/app; file_server; SPA fallback) ...
}
```
`reload`: `caddy reload --config /etc/caddy/Caddyfile` (yoki `systemctl reload caddy`).

**3) Tekshirish:**
```bash
curl -I https://clary.uz/download/Clary_0.1.0_x64-setup.exe   # 200 + octet-stream
curl    https://clary.uz/download/latest.json                  # JSON manifest
```

- Klinika `.exe`ni yuklab o'rnatadi; keyin ilova `latest.json`dan **avto-yangilanadi**.
- Boshida ilova OS code-signing'siz — SmartScreen ogohlantirishini onboarding'da
  bir marta "Batafsil → Baribir ishga tushirish" bilan o'tasiz. (Updater ed25519 imzosi —
  bu OS code-signing'dan alohida va majburiy; u allaqachon bor.)

**Yangi versiya chiqarish:** `version`ni (`tauri.conf.json` + `package.json`) oshiring →
`tauri build` → yangi `.exe`/`.sig`/`latest.json`ni yuklang. O'rnatilgan ilovalar
o'zi aniqlab yangilanadi.

---

## Xavfsizlik (tekshirish ro'yxati)
- Faqat lokal bundlangan asset yuklanadi (remote URL emas).
- Qattiq CSP `tauri.conf.json`da — `connect-src` faqat api.clary.uz / supabase / posthog.
- Minimal capabilities (`capabilities/default.json`) — fs/shell/process YO'Q.
- Tashqi havolalar tizim brauzerida (`tauri-plugin-opener`).
- Bundlda sir yo'q — faqat publishable Supabase anon key.
- Updater ed25519-imzolangan; maxfiy kalit repodan tashqarida.
- Release'da devtools o'chiq (`windows_subsystem = "windows"`).
