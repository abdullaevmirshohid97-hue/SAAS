# Bulutli ATS — har klinikaning IP-telefoniyasi Clary'da

Har klinika Uztelecom'dan **IP-telefoniya** raqami oladi (taxminan 60 000 so'm/oy, 45 000 daqiqa
kiruvchi+chiquvchi). Raqam to'g'ridan-to'g'ri Clary serveridagi Asterisk'ga ulanadi. Natija:

- kiruvchi qo'ng'iroq **stol IP telefonlari** va **Clary ilovasida (kompyuterda)** birdan jiringlaydi —
  kim birinchi olsa, o'sha gaplashadi; ekranda bemor kartasi (ism, keyingi navbat) chiqadi;
- `N` soniyada hech kim olmasa (yoki ish vaqtidan tashqari) — **AI qabulxona** javob beradi, kerak
  bo'lsa yana xodimlarga ulaydi;
- chiquvchi qo'ng'iroq — bemor kartasidagi **"Qo'ng'iroq"** tugmasi (yoki softfon teruvchisi),
  bemor klinika raqamini ko'radi;
- har qo'ng'iroq jurnalda: kim oldi, o'tkazib yuborilganlar (bir bosishda qayta qo'ng'iroq), yozuv.

```
Bemor ──► klinika raqami (Uztelecom IP-telefoniya)
                │ SIP (registration, ;line=)
                ▼
   Asterisk (Clary ATS serveri) ── pjsip_clary.conf / extensions_clary.conf
     │   ▲          ▲                        ▲  voice-agent har 30 s Clary API'dan yozadi
     │   │          │ wss://pbx.../ws        │  (GET /telephony/agent/config)
     │   │ UDP/TCP  │ (Caddy → 127.0.0.1:8088)
     │   │          │
     │  stol IP   Clary softfoni (brauzer / desktop, WebRTC)
     │  telefoni
     ▼
   hech kim olmasa → [clary-ai] → voice-agent → AI qabulxona (Faza 3)
   qo'ng'iroq tugadi → voice-agent → API: pbx_calls + yozuv (call-recordings)
```

## Kodda nimalar bor

| Joy                                                           | Nima                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `supabase/migrations/20261015000001_cloud_pbx.sql`            | `pbx_tenants`, `pbx_extensions`, `pbx_calls` (faqat service_role)                                      |
| `apps/api/src/modules/telephony/`                             | Sozlama, ichki raqamlar, softfon akkaunti (HA1 + TURN), jurnal, voice-agent API                        |
| `apps/voice-agent/src/pbx/`                                   | Asterisk sozlamasini generatsiya (`render.ts`), sinxron, holat, CDR + yozuv                            |
| `infra/asterisk/`                                             | `pjsip.conf` (shablonlar, ws), `extensions.conf`, `http.conf`, `rtp.conf`, coturn, Caddy, `install.sh` |
| `apps/web-clinic/src/lib/softphone/`, `components/softphone/` | JsSIP softfon: sarlavhadagi 📞, kiruvchi oyna, teruvchi, ulash, hold, DTMF                             |
| `apps/web-clinic/src/pages/settings/telephony.tsx`            | Sozlamalar → **IP-telefoniya (ATS)**                                                                   |
| `apps/web-clinic/src/pages/calls.tsx`                         | Qo'ng'iroqlar → **Klinika raqami (ATS)** tabi                                                          |

## Bir marta: server (siz)

1. **Server.** O'zbekistondagi VPS tavsiya etiladi (2 vCPU, 2–4 GB RAM, ommaviy IPv4, Ubuntu
   22.04/24.04). Sabab: Uztelecom SIP'ni ko'pincha faqat UZ IP'laridan qabul qiladi, ovoz
   kechikishi kam, yozuvlar UZ'da (lokalizatsiya). Hozirgi Clary VPS'ga ham o'rnatsa bo'ladi.
2. **DNS.** `pbx.clary.uz` A-yozuvi → shu server IP'si. (Boshqa domen tanlasangiz,
   `infra/caddy/Caddyfile` CSP'dagi `wss://pbx.clary.uz` ni ham almashtiring.)
3. **O'rnatish:**
   ```bash
   git clone <repo> /opt/clary && cd /opt/clary
   PBX_DOMAIN=pbx.clary.uz bash infra/asterisk/install.sh
   ```
   Skript: Asterisk + modullar, `pjsip/extensions/rtp/http.conf`, firewall (5060 udp/tcp,
   10000–10999 udp, 80/443, 3478, 50000–50999 udp), fail2ban, coturn, Caddy (TLS avtomatik),
   voice-agent (`PBX_ENABLED=true`), zaxira ovozlar. Takroran ishga tushirish xavfsiz.
   Oxirida **API uchun env** chiqadi.
4. **API serverida** `/opt/clary/.env.local` ga (skript chiqargan qiymatlar):
   ```
   VOICE_AGENT_SECRET=<voice-agent .env dagi bilan BIR XIL>
   PBX_SIP_DOMAIN=pbx.clary.uz
   PBX_WSS_URL=wss://pbx.clary.uz/ws
   TURN_SECRET=<install.sh chiqargan>
   ```
   So'ng `pm2 restart clary-api --update-env` (**pm2 delete QILMANG**).
5. **Migratsiya + kod:** `D:\1997\deploy-ai-reception.ps1` (yoki serverda
   `bash scripts/deploy-ai-reception.sh`) — `20261015000001_cloud_pbx.sql` ni ham qo'llaydi va
   tekshiradi, keyin api/web'ni yig'adi.
6. **app.clary.uz Caddy** (`/etc/caddy/Caddyfile`, Clary VPS): `Permissions-Policy` da
   `microphone=(self)` bo'lsin (aks holda softfon mikrofonni ololmaydi), CSP bo'lsa
   `connect-src` ga `wss://pbx.clary.uz`, `media-src` ga Supabase manzili. Namuna:
   `infra/caddy/Caddyfile`. So'ng `caddy validate` → `systemctl restart caddy` (admin off).

Tekshirish (ATS serverida):

```bash
curl -s http://127.0.0.1:7071/health | jq .pbx   # error: null, tenants: N
asterisk -rx "pjsip show registrations"          # trunk-<kod> → Registered
asterisk -rx "pjsip show contacts"               # onlayn telefonlar / softfonlar
asterisk -rx "http show status"                  # Enabled and Bound to 127.0.0.1:8088
tail -f /var/log/asterisk/clary_fail2ban         # rad etilgan urinishlar
```

## Har klinika uchun (klinika yoki siz, ~20 daqiqa)

1. **Uztelecom bilan shartnoma** — IP-telefoniya. So'rang va yozib oling:
   - SIP server manzili, port (5060), transport (UDP/TCP);
   - SIP login, parol, **raqam (DID)**;
   - **tashqi serverdan (bizning VPS IP) ro'yxatdan o'tish mumkinmi** — IP whitelist kerak bo'lsa,
     ATS server IP'sini bering;
   - **bir vaqtdagi liniyalar soni** (kamida 2–4 kanal — aks holda bir bemor gaplashayotganda
     ikkinchisi "band" eshitadi);
   - kodek G.711 (A-law/PCMA), DTMF RFC2833, chiquvchida CallerID = klinika raqami.
2. Clary → **Sozlamalar → IP-telefoniya (ATS)**: server, login, parol, klinika raqami → **yoqing**
   → Saqlash. 30–60 soniyada "Uztelecom liniyasi: **Ulangan**" bo'ladi.
3. **Ichki raqamlar:** 201 — Qabulxona, 202 — Kassa ... Har biriga Clary xodimini biriktiring
   (o'sha xodim Clary'ga kirganda kompyuteri ham telefon). Faqat stol telefoni bo'lsa — xodimsiz.
4. **Stol IP telefoni** (Yealink/Fanvil/Grandstream, ~400–900 ming so'm): ichki raqam qatoridagi 🔑
   → server/login/parol → telefon veb-panelidagi Account bo'limiga. Kompyuterda Clary ochib
   bo'lmasa — MicroSIP/Zoiper ham shu ma'lumot bilan ishlaydi.
5. **Softfon:** xodim Clary'ga kiradi → sarlavhadagi 📞 **yashil**. Quloqchin + mikrofon kerak;
   brauzer mikrofon ruxsatini so'raydi — "Ruxsat berish".
6. **AI qabulxona** (ixtiyoriy): Sozlamalar → AI qabulxona → rejim "AI suhbat" (premium) yoki
   "Ovozli xabar". O'chiq bo'lsa — hech kim olmasa "keyinroq qo'ng'iroq qiling" xabari va jurnalda
   "O'tkazib yuborildi".
7. **Sinov:** mobil telefondan klinika raqamiga → telefonlar jiringlaydi → olmang → AI javob
   beradi → "operator" deng → yana jiringlaydi. Clary'dan bemorga qo'ng'iroq → bemor klinika
   raqamini ko'radi. Qo'ng'iroqlar → "Klinika raqami (ATS)" da yozuvlar.
8. **Eski raqam** (mobil/shahar) ham ishlatilsa: unga **pereadresatsiya** qiling —
   `**21*<yangi IP raqam>#` (hammasi) yoki `**61*<raqam>**20#` (javob bermasa).

## Qanday ishlaydi (texnik)

- **Bir operatorga ko'p klinika:** har trunk `registration line=yes` — kiruvchi INVITE
  `;line=` bo'yicha to'g'ri klinikaga tushadi. Operator `line` ni qaytarmasa — `[clary-pbx-provider]`
  Request-URI (login/raqam) bo'yicha topadi. Trunk endpointlari `identify_by=ip` — From'ni
  soxtalashtirib parolsiz kirib bo'lmaydi.
- **Parollar:** ichki raqam parollari Asterisk'ka **HA1** (md5) bo'lib boradi; softfonga ham parol
  emas HA1 beriladi (`/telephony/me`, faqat biriktirilgan xodimga). Trunk paroli faqat
  `pjsip_clary.conf` da (640, asterisk egasi).
- **Ish vaqti:** Sozlamalar → Katalog → Ish vaqti va bayramlar → `GotoIfTime` (Asia/Tashkent).
- **Chiquvchi:** faqat `998XXXXXXXXX` / 9 raqam / `+998...` va favqulodda 101–104, 112.
  Xalqaro yopiq; bir vaqtdagi chiquvchi soni `max_outbound` bilan cheklangan (firibgarlikdan himoya).
  Ichki raqamlar 201–899 (1XX — favqulodda raqamlar bilan to'qnashmasin).
- **Yozuv:** `MixMonitor(...,b)` — faqat odam gaplashgan qism; AI qismi AI qabulxona yozuvida.
  Tugagach voice-agent Clary'ga yuklaydi va lokal faylni o'chiradi (`PBX_KEEP_RECORDINGS`).
- **Holat:** voice-agent har 30 s `pjsip show registrations/contacts` → sozlamalar sahifasidagi
  "Ulangan" va yashil nuqtalar.

## Nosozliklar

| Belgi                                 | Sabab / yechim                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uztelecom liniyasi: **Rad etildi**    | Login/parol xato yoki operator VPS IP'ini qabul qilmaydi (whitelist). `asterisk -rx "pjsip show registrations"`, `pjsip set logger on`             |
| "Hali tekshirilmadi" o'zgarmaydi      | voice-agent `PBX_ENABLED` emas yoki API'ga ulana olmayapti: `curl -s 127.0.0.1:7071/health`, `pm2 logs clary-voice`                                |
| Kiruvchi kelmaydi, chiquvchi ishlaydi | Operator `;line=` va login'ni qaytarmayapti — `pjsip set logger on` da INVITE'ning Request-URI'sini ko'ring, kerak bo'lsa DID'ni to'g'ri kiriting  |
| Softfon 🔴 / 🟡 "ulanmoqda"           | `PBX_WSS_URL`, DNS, Caddy (`curl -I https://pbx.clary.uz`), app CSP `connect-src wss://pbx...`; Asterisk `http show status`                        |
| Ovoz bir tomonlama / yo'q             | RTP portlari (10000–10999/udp) yopiq; server NAT ortida bo'lsa `external_media_address` (pjsip.conf); softfon uchun TURN (3478, 50000–50999)       |
| Mikrofon so'ralmaydi                  | app.clary.uz `Permissions-Policy: microphone=(self)`; desktop (Windows) — WebView2 ruxsat oynasi; brauzer sozlamasida sayt uchun mikrofon "Ruxsat" |
| Jiring eshitilmaydi                   | Brauzer ovozni sahifa bosilmaguncha bloklaydi — Clary'da biror joyni bir marta bosing                                                              |
| AI'ga o'tmaydi                        | AI qabulxona rejimi o'chiq yoki voice-agent'da `AISHA_API_KEY` yo'q (`pm2 logs clary-voice` → "AI suhbat o'chiq" ogohlantirishi)                   |

## Xarajat (har klinika)

| Narsa                        | Narxi                                                    |
| ---------------------------- | -------------------------------------------------------- |
| Uztelecom IP-telefoniya      | ~60 000 so'm/oy (45 000 daqiqa), ortig'i ~12 so'm/daqiqa |
| Stol IP telefoni (ixtiyoriy) | bir martalik ~400–900 ming so'm                          |
| Softfon                      | bepul (Clary ichida); quloqchin                          |
| AI qabulxona (ixtiyoriy)     | [04-xarajat-va-tarif.md](04-xarajat-va-tarif.md)         |
| Clary ATS serveri            | barcha klinikalarga bitta (~$10–20/oy)                   |
