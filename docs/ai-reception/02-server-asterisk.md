# Server: Asterisk + voice-agent

## Qayerga o'rnatiladi

| Variant                                                               | Afzalligi                                                                                                                                 | Kamchiligi                                                  |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **O'zbekistondagi VPS** (UZCLOUD, Uztelecom DC va h.k.) — **tavsiya** | Ovoz va yozuvlar UZ'da qoladi (lokalizatsiya), operatorlarga yaqin, kechikish kam, Uztelecom SIP ko'pincha faqat UZ IP'larni qabul qiladi | Alohida server ($10–20/oy)                                  |
| Hozirgi Clary VPS (Hostinger)                                         | Qo'shimcha server yo'q                                                                                                                    | Chet elda; 5 ta sayt bilan bir joyda; SIP portlari ochiladi |

Minimal talab: 2 vCPU, 2 GB RAM, ommaviy IPv4, Ubuntu 22.04/24.04, Node 20, pnpm.
Asterisk + voice-agent 20 ta bir vaqtdagi qo'ng'iroqqa ham 1 vCPU'da yetadi. Tashqi nutq
xizmati ishlatilmaydi: ATS va ovozli xabar uchun nutq serveri kerak emas; AI suhbat uchun
o'zimizning serverlar (`infra/voice-models`) — jonli suhbatda GPU tavsiya etiladi, RAM 4 GB+.

## O'rnatish (bir marta)

```bash
# 1) Repo (alohida serverda — faqat kerakli qismi yig'iladi)
git clone <repo> /opt/clary && cd /opt/clary

# 2) Hammasi bitta skriptda: asterisk, konfiguratsiya, firewall, fail2ban, voice-agent (pm2)
bash infra/asterisk/install.sh
# Bulutli ATS ham kerak bo'lsa (klinikalarning IP-telefoniyasi) — 05-bulut-ats.md:
# PBX_DOMAIN=pbx.clary.uz bash infra/asterisk/install.sh
```

> `pjsip.conf` / `extensions.conf` har `install.sh` da repo'dagisi bilan almashtiriladi.
> Qo'lda yoziladigan akkauntlar (GoIP, qo'lda trunk) — `/etc/asterisk/pjsip_local.conf`
> (bir marta yaratiladi, keyin tegilmaydi). Bulutli ATS fayllari (`*_clary.conf`) — voice-agent yozadi.

Skript tugagach:

1. **GoIP parollari** ekranga chiqadi — ularni shlyuz paneliga kiriting.
2. `apps/voice-agent/.env` — `VOICE_API_URL=https://api.clary.uz` va `VOICE_AGENT_SECRET`
   (API `.env.local` dagi bilan BIR XIL; `install.sh` API'dagisini o'zi ko'chiradi yoki yaratib,
   ekranga chiqaradi). So'ng `pm2 restart clary-voice --update-env`.
3. **Ovozli xabarlar** (Asterisk o'qiydigan iboralar: "signaldan keyin xabar qoldiring" va h.k.):
   o'zingiz telefon diktofoniga yozib olasiz — matnlar:
   `cd apps/voice-agent && node dist/scripts/gen-sounds.js --list`. Fayllarni
   `/opt/clary-sounds/<nom>.m4a` qilib qo'ying va `bash infra/asterisk/sounds.sh`.
4. **AI suhbat kerak bo'lsa** (ixtiyoriy): `bash infra/voice-models/install.sh` — o'zimizning
   STT/TTS serverlari, voice-agent'ni o'zi ulaydi.
5. **API serverida** (`/opt/clary/.env.local`): `VOICE_AGENT_SECRET=<o'sha kalit>`,
   `AI_RECEPTION_MODEL=claude-haiku-4-5`; Telegram ovozli xabarlari uchun (ixtiyoriy)
   `voice-models/install.sh` chiqargan `AI_STT_PROVIDER/STT_OPENAI_URL/STT_OPENAI_KEY`.
   So'ng `pm2 restart clary-api --update-env`. **pm2 delete QILMANG** — `server_env_incident` saboqlari.

## Tekshirish

```bash
curl -s http://127.0.0.1:7071/health            # {"ok":true, "stt":"openai", "tts":"http", "speech_ok":true, ...}
asterisk -rx "pjsip show endpoints"             # goip1 → Avail
asterisk -rx "pjsip show registrations"         # SIP trunk → Registered
asterisk -rx "module show like audiosocket"     # 2 ta modul
pm2 logs clary-voice                            # qo'ng'iroqlar: "bemor: ..." / "AI: ..."
```

Asterisk'siz sinov (voice-agent → API → AI → TTS):

```bash
cd /opt/clary/apps/voice-agent
node dist/scripts/simulate-call.js --line goip1 --from 901234567
# klaviaturadan yozasiz → AI javobi matnda va out/sim-*.wav da (telefon sifatida)
```

> ⚠️ `simulate-call` HAQIQIY qo'ng'iroq yozuvini yaratadi va AI navbatga **yozadi**.
> Xavfsiz sinov uchun ilovadagi "Sinov suhbati"dan foydalaning.

## Yangilash

```bash
cd /opt/clary && git pull --ff-only origin main
pnpm install --filter @clary/voice-agent...
pnpm --filter @clary/voice-agent build
pm2 restart clary-voice
```

Asterisk konfiguratsiyasi o'zgarsa — `install.sh` ni qayta ishga tushiring (zaxira oladi,
`pjsip_local.conf` va `*_clary.conf` ga tegmaydi). Faqat dialplan bo'lsa:
`cp infra/asterisk/extensions.conf /etc/asterisk/ && asterisk -rx "dialplan reload"`.

## Qanday ishlaydi (nosozlikni topish uchun)

1. Kiruvchi qo'ng'iroq `from-goip` yoki `from-trunk` kontekstiga keladi va `clary-ai` ga o'tadi.
2. Dialplan qo'ng'iroq UUID'ini yaratadi va `CURL http://127.0.0.1:7071/calls/register?...`
   so'rovini yuboradi (liniya, DID, bemor raqami).
3. `AudioSocket(UUID, 127.0.0.1:9092)` — 8 kHz ovoz voice-agent'ga oqadi.
4. voice-agent `POST /api/v1/ai-reception/voice/start` → klinika va rejim aniqlanadi →
   salomlashuv (TTS) yangraydi.
5. Bemor gapiradi → VAD gap tugaganini aniqlaydi (sukunat 700 ms) → STT → `voice/turn` →
   AI javobi → TTS. Javob 1.3 soniyadan ko'p kechiksa, "Bir daqiqa, qarab beraman" deyiladi.
6. Suhbat tugaydi → yozuv (WAV) `voice/recording` ga yuboriladi → `voice/end` chaqiriladi.
7. Dialplan `GET /calls/next` so'raydi: `hangup` / `transfer:+998...` / `fallback`.

## Nosozliklar

| Belgisi                                    | Tekshirish                               | Yechim                                                                                                        |
| ------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Qo'ng'iroq darhol uziladi                  | `asterisk -rvvv` loglari                 | `REG != OK` bo'lsa voice-agent ishlamayapti (`pm2 status`). `func_curl` / `func_shell` modullari bormi?       |
| "Kechirasiz, javob bera olmaymiz" (reject) | `pm2 logs clary-api` → `noma'lum liniya` | Ilovada liniya kaliti `CHANNEL(endpoint)` (`goip1`) yoki DID'ga mos emas                                      |
| AI jim (salomlashmaydi)                    | `pm2 logs clary-voice` → TTS xato        | `systemctl status clary-tts`, `TTS_HTTP_URL`/`TTS_HTTP_KEY` (voice-agent .env)                                |
| AI bemorni eshitmaydi                      | `/health`, loglarda "bemor:" yo'q        | Bir tomonlama ovoz: NAT (`rtp_symmetric=yes`), firewall 10000–10200/udp; shovqinli liniyada `VAD_START_DB=15` |
| AI gapni bo'lib yuboradi                   | Bemor o'ylab gapirganda                  | `VAD_END_SILENCE_MS=900`                                                                                      |
| AI juda sekin javob beradi                 | Loglarda vaqt                            | STT/TTS kechikishi (benchmark), model (`claude-haiku-4-5` eng tezi)                                           |
| `API turn xato 401`                        | Kalitlar                                 | `VOICE_AGENT_SECRET` API va voice-agent'da bir xil bo'lsin                                                    |
| `503 VOICE_AGENT_SECRET sozlanmagan`       | API env                                  | API `.env.local` + `pm2 restart clary-api --update-env`                                                       |
| Odamga ulanmaydi                           | `NEXT=transfer:...` keladi, `Dial` xato  | GoIP-1 (band) → `TRANSFER_ENDPOINT=goip2`, `TRANSFER_NUMBER_FORMAT=local9`                                    |

## Xavfsizlik

- 7071 (boshqaruv) va 9092 (AudioSocket) **faqat 127.0.0.1** da tinglaydi — tashqaridan yopiq.
- 5060/udp ochiq: kuchli GoIP parollari va fail2ban (`install.sh` sozlaydi). Imkon bo'lsa,
  faqat GoIP yoki operator IP'lariga ruxsat bering.
- `VOICE_AGENT_SECRET` faqat ikki joyda saqlanadi: API `.env.local` va voice-agent `.env`.
  Uni `D:\1997\PAROLLAR.md` ga ham yozib qo'ying.
