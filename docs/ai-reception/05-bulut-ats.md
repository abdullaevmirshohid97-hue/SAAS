# Bulutli ATS — har klinikaning IP-telefoniyasi Clary'da

Har klinika Uztelecom'dan **IP-telefoniya** raqami oladi (taxminan 60 000 so'm/oy, 45 000 daqiqa
kiruvchi+chiquvchi). Raqam to'g'ridan-to'g'ri Clary serveridagi Asterisk'ga ulanadi. Faqat
**Uztelecom + Clary** — boshqa tashqi xizmat (nutq provayderi va h.k.) kerak emas. Natija:

- kiruvchi qo'ng'iroq **stol IP telefonlari** va **Clary ilovasida (kompyuterda)** birdan jiringlaydi —
  kim birinchi olsa, o'sha gaplashadi; ekranda bemor kartasi (ism, keyingi navbat) chiqadi;
- `N` soniyada hech kim olmasa (yoki ish vaqtidan tashqari) — bemor signaldan keyin **ovozli
  xabar** qoldiradi (yozuv Clary'da, qayta qo'ng'iroq ro'yxatida). Klinika xohlasa — o'rniga **AI
  qabulxona** (o'zimizning nutq serverlari bilan) yoki faqat "keyinroq qo'ng'iroq qiling" xabari;
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
   hech kim olmasa → ovozli xabar (Record, AI'siz) | [clary-ai] → AI qabulxona | xabar
   qo'ng'iroq tugadi → voice-agent → API: pbx_calls + yozuv (call-recordings)
```

## Kodda nimalar bor

| Joy                                                           | Nima                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `supabase/migrations/20261015000001_cloud_pbx.sql`            | `pbx_tenants`, `pbx_extensions`, `pbx_calls` (faqat service_role)                                      |
| `apps/api/src/modules/telephony/`                             | Sozlama, ichki raqamlar, softfon akkaunti (HA1 + TURN), jurnal, voice-agent API                        |
| `apps/voice-agent/src/pbx/`                                   | Asterisk sozlamasini generatsiya (`render.ts`), sinxron, holat, CDR + yozuv                            |
| `infra/asterisk/`                                             | `pjsip.conf` (shablonlar, ws), `extensions.conf`, `http.conf`, `rtp.conf`, coturn, Caddy, `install.sh` |
| `infra/asterisk/sounds.sh`                                    | O'zingiz yozib olgan iboralarni (m4a/mp3/ogg) Asterisk formatiga o'giradi                              |
| `infra/voice-models/`                                         | Ixtiyoriy: o'zimizning STT/TTS serverlari (AI suhbat, ovozli xabar matni) — `install.sh`               |
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
   voice-agent (`PBX_ENABLED=true`). Takroran ishga tushirish xavfsiz.
   Oxirida **API uchun env** chiqadi.
4. **Ovozli xabarlar** (bemor eshitadigan iboralar) — o'zingiz telefon diktofoniga o'qiysiz:
   matnlar `cd apps/voice-agent && node dist/scripts/gen-sounds.js --list` (8 ta ibora:
   `vm_prompt` — "signaldan keyin xabar qoldiring", `vm_thanks`, `pbx_noanswer` ...).
   Fayllarni serverga `/opt/clary-sounds/<nom>.m4a` qilib qo'ying (WinSCP / scp) va:
   `bash infra/asterisk/sounds.sh` — ovoz balandligi tekislanib, telefon formatiga o'giriladi.
5. **AI suhbat kerak bo'lsa (ixtiyoriy):** `bash infra/voice-models/install.sh` — o'zimizning
   STT/TTS serverlari shu serverda. Jonli suhbat uchun GPU tavsiya etiladi; GPU'siz ham ovozli
   xabar matni va Telegram ovozli xabarlari ishlaydi. Nutq serverlari ishlamasa ATS o'zi
   ovozli xabarga o'tadi — bemor hech qachon jim qolmaydi.
6. **API serverida** `/opt/clary/.env.local` ga (skript chiqargan qiymatlar):
   ```
   VOICE_AGENT_SECRET=<voice-agent .env dagi bilan BIR XIL>
   PBX_SIP_DOMAIN=pbx.clary.uz
   PBX_WSS_URL=wss://pbx.clary.uz/ws
   TURN_SECRET=<install.sh chiqargan>
   ```
   (5-qadam bajarilgan bo'lsa — ovozli xabar matni uchun `AI_STT_PROVIDER=openai`,
   `STT_OPENAI_URL=https://pbx.clary.uz/stt`, `STT_OPENAI_KEY` ham.)
   So'ng `pm2 restart clary-api --update-env` (**pm2 delete QILMANG**).
7. **Migratsiya + kod:** `D:\1997\deploy-ai-reception.ps1` (yoki serverda
   `bash scripts/deploy-ai-reception.sh`) — `20261015000001_cloud_pbx.sql` ni ham qo'llaydi va
   tekshiradi, keyin api/web'ni yig'adi.
8. **app.clary.uz Caddy** (`/etc/caddy/Caddyfile`, Clary VPS): `Permissions-Policy` da
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
6. **Hech kim olmasa** (shu sahifada): "Ovozli xabar qoldirsin" (standart, bepul) / "AI qabulxona"
   (AI qabulxona rejimi "AI suhbat" + premium + nutq serverlari bo'lsa; aks holda ovozli xabar) /
   "Faqat xabar".
7. **Sinov:** mobil telefondan klinika raqamiga → telefonlar jiringlaydi → olmang → signal →
   xabar qoldiring → Qo'ng'iroqlar → "Klinika raqami (ATS)" da **Ovozli xabar** (tinglash, qayta
   qo'ng'iroq). Clary'dan bemorga qo'ng'iroq → bemor klinika raqamini ko'radi.
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
  Ovozli xabar — `Record()` (signal, 5 s jimlik yoki 120 s). Tugagach voice-agent Clary'ga
  yuklaydi va lokal faylni o'chiradi (`PBX_KEEP_RECORDINGS`). STT serveri bo'lsa — xabar matni ham.
- **AI holati:** voice-agent har daqiqa nutq serverlarini tekshiradi (`/health` → `speech_ok`);
  ishlamasa dialplan avtomatik "AI → ovozli xabar"ga qayta yoziladi.
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
| Ovozli xabar o'rniga jimlik           | Iboralar yo'q: `ls /var/lib/asterisk/sounds/clary` — 8 ta `.wav` bo'lsin (`bash infra/asterisk/sounds.sh`)                                         |
| AI'ga o'tmaydi                        | "Hech kim olmasa" = AI emas, AI qabulxona rejimi/premium o'chiq yoki nutq serverlari ishlamayapti (`/health` → `speech_ok: false`)                 |

## Xarajat (har klinika)

| Narsa                        | Narxi                                                       |
| ---------------------------- | ----------------------------------------------------------- |
| Uztelecom IP-telefoniya      | ~60 000 so'm/oy (45 000 daqiqa), ortig'i ~12 so'm/daqiqa    |
| Stol IP telefoni (ixtiyoriy) | bir martalik ~400–900 ming so'm                             |
| Softfon                      | bepul (Clary ichida); quloqchin                             |
| Ovozli xabar                 | bepul (Asterisk o'zi yozadi)                                |
| AI qabulxona (ixtiyoriy)     | faqat LLM (~170 so'm/qo'ng'iroq); nutq — o'zimizning server |
| Clary ATS serveri            | barcha klinikalarga bitta (~$10–20/oy)                      |
