# Runbook — Mahsulot uptime monitoringi (UptimeRobot)

Clary 99.9% uptime SLA'sini tashqi (external) monitor bilan kuzatadi.
Tashqi monitor — chunki API o'zini-o'zi tekshira olmaydi (server o'lsa, log ham yo'q).

## Endpointlar

| Endpoint | Maqsad | Javob |
|----------|--------|-------|
| `GET /health` | Liveness probe — UptimeRobot ping qiladi | 200 = up, 503 = down (API + DB tekshiradi) |
| `GET /status` | status.clary.uz uchun snapshot | `{ status, uptimeSeconds, components }` |

`/health` DB ulanishini ham tekshiradi (`clinics` jadvaliga head-query).
DB yiqilsa → 503 → UptimeRobot alert beradi.

## UptimeRobot sozlash (bir martalik)

1. https://uptimerobot.com — bepul account (50 monitor, 5 daqiqa interval).
2. **Add New Monitor**:
   - Type: `HTTP(s)`
   - Friendly Name: `Clary API`
   - URL: `https://api.clary.uz/health`
   - Monitoring Interval: `5 minutes` (bepul) / `1 minute` (pullik)
3. Yana 2 ta monitor qo'shing:
   - `Clary Web` → `https://app.clary.uz`
   - `Clary Landing` → `https://clary.uz`
4. **Alert Contacts**: email (`ops@clary.uz`) + Telegram integratsiya.
   - Telegram: UptimeRobot'da "Add Alert Contact" → Telegram → bot bilan bog'lash.
5. **Public Status Page** (ixtiyoriy): Settings → Status Pages →
   `status.clary.uz` ga CNAME ulang. Mijozlarga ko'rinadigan uptime sahifa.

## SLA hisobi

- Oylik 99.9% = oyiga maksimum **~43 daqiqa** downtime.
- UptimeRobot dashboard'da har monitor uchun uptime % avtomatik chiqadi.
- Enterprise mijozlarga oylik uptime hisoboti — UptimeRobot'dan eksport.

## Downtime bo'lsa — birinchi qadamlar

1. UptimeRobot alert → `docs/runbooks/incident.md` jarayonini boshlang.
2. `GET /status` ni qo'lda tekshiring — qaysi komponent (api/database) yiqilgan.
3. `database.status = down` → Supabase Dashboard → Project health.
4. `api` javob bermayapti → VPS'da `pm2 status`, `pm2 logs clary-api`.
5. Tiklangach UptimeRobot avtomatik "Up" alert yuboradi.
