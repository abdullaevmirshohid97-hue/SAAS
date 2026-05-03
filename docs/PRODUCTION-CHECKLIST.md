# CLARY CARE — Production Deploy Checklist

**Holat (2026-05-04):** Backend + Migration + Deploy.sh tayyor. Quyidagi qadamlarni siz bajarasiz.

---

## ✅ Bajarilgan (avtomatik, MCP orqali)

- ✅ Supabase Cloud'ga `20260503120000_security_hardening` migration qo'llandi
- ✅ Supabase Cloud'ga `20260503130000_support_tables_enable_rls` qo'llandi
- ✅ Advisor natijasi: **P0 = 0** (13 dan 0 ga)
- ✅ deploy.sh ga `deploy_web_landing()` qo'shildi va push qilindi

---

## 🔴 1. Supabase Console qadamlari (siz bajarasiz, ~5 daqiqa)

URL: https://supabase.com/dashboard/project/aoubdvlkcatbeifuysau

| # | Yo'l | Amal |
|---|------|------|
| 1.1 | **Authentication → Providers → Email** | "Leaked password protection" toggle = **ON** |
| 1.2 | **Authentication → Providers → Google** | Client ID + Secret tushiring (Bosqich 2'dan), **enabled = ON** |
| 1.3 | **Authentication → URL Configuration** | Site URL: `https://app.clary.uz`<br>Redirect URLs: `https://patient.clary.uz/**`, `https://app.clary.uz/**` |
| 1.4 | **Storage → site-media** | "Public bucket" = **OFF** (faqat signed URL) |
| 1.5 | **Storage → staff-files** | "Public bucket" = **OFF** |

---

## 🔵 2. Google Cloud Console — OAuth Client (~10 daqiqa)

URL: https://console.cloud.google.com/apis/credentials

1. **Create Credentials → OAuth client ID**
2. **Application type:** Web application
3. **Name:** Clary Care Production
4. **Authorized JavaScript origins:**
   ```
   https://clary.uz
   https://app.clary.uz
   https://patient.clary.uz
   https://aoubdvlkcatbeifuysau.supabase.co
   ```
5. **Authorized redirect URIs:**
   ```
   https://aoubdvlkcatbeifuysau.supabase.co/auth/v1/callback
   ```
6. **Save** → Client ID + Client Secret nusxalang
7. → 1.2 ga qo'ying (Supabase Console)

---

## 🟢 3. DNS yozuvlari (DNS provayder panelida)

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | clary.uz | `<server IP>` | Auto |
| A | app | `<server IP>` | Auto |
| A | api | `<server IP>` | Auto |
| A | admin | `<server IP>` | Auto |
| A | patient | `<server IP>` | Auto |
| A | docs | `<server IP>` | Auto |
| A | status | `<server IP>` | Auto |
| A | cdn | `<server IP>` | Auto |
| CNAME | www | `clary.uz` | Auto |

**Cloudflare ishlatsangiz:** Proxy = **OFF (DNS only, gray cloud)** — Caddy o'zi Let's Encrypt SSL oladi.

---

## 🟡 4. Server `.env.local` (siz `/opt/clary/.env.local`)

```bash
# Supabase
SUPABASE_URL=https://aoubdvlkcatbeifuysau.supabase.co
SUPABASE_ANON_KEY=<from Supabase → Settings → API>
SUPABASE_SERVICE_ROLE_KEY=<from Supabase → Settings → API>
SUPABASE_JWT_SECRET=<from Supabase → Settings → API>
DATABASE_URL=postgresql://postgres.aoubdvlkcatbeifuysau:<password>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres

# Google OAuth (from Bosqich 2)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://aoubdvlkcatbeifuysau.supabase.co/auth/v1/callback

# SMS OTP (Eskiz.uz)
ESKIZ_EMAIL=<your-eskiz-account>
ESKIZ_PASSWORD=<api-password>

# Frontend (vite.* prefiks majburiy)
VITE_SUPABASE_URL=https://aoubdvlkcatbeifuysau.supabase.co
VITE_SUPABASE_ANON_KEY=<same as SUPABASE_ANON_KEY>

# Ixtiyoriy — telemetriya
SENTRY_DSN=
POSTHOG_API_KEY=
VITE_POSTHOG_KEY=
```

---

## 🟣 5. Caddyfile IP allowlist (admin sahifa uchun)

`/etc/caddy/Caddyfile` faylida `admin.clary.uz` blokida `remote_ip` qatoriga sizning IP'ni qo'shing:

```caddy
admin.clary.uz {
  @allowed {
    remote_ip 127.0.0.1 <SIZNING_OFIS_IP> <SIZNING_UY_IP>
  }
  ...
}
```

IP'ni topish: `curl ifconfig.me`

---

## ⚪ 6. Server deploy (siz SSH orqali)

```bash
ssh root@<server>

cd /opt/clary
git pull origin main

# Birinchi marta bo'lsa, Caddyfile'ni o'rnating
cp infra/caddy/Caddyfile /etc/caddy/Caddyfile

# Hammasini build + deploy
chmod +x deploy.sh
./deploy.sh all

# Caddy reload (deploy.sh o'zi qiladi, lekin alohida ham mumkin)
caddy reload --config /etc/caddy/Caddyfile

# API holatini tekshirish
pm2 logs clary-api --lines 50 --nostream
```

---

## ✅ 7. Smoke test (deploy tugagach)

```bash
curl -s https://api.clary.uz/api/v1/health
# → {"status":"ok"}
```

Brauzerda:
- https://clary.uz — landing (role selector)
- https://app.clary.uz — clinic (Google Sign-In ishlashi)
- https://patient.clary.uz — patient
- https://admin.clary.uz — admin (faqat sizning IP'dan)
- https://docs.clary.uz — Swagger UI

---

## 📋 8. Qolgan xavfsizlik tavsiyalari (P0 emas, lekin yaxshi)

Advisor 281 ta WARN qoldirgan, asosan:
- **256 ta** — `pg_graphql_*_table_exposed` — barcha public jadvallar GraphQL'da ochiq. Bu **dizayn bo'yicha** (PostgREST RLS bilan himoyalaydi). Lock qilmoqchi bo'lsangiz, GraphQL endpointini o'chiring.
- **8 ta** — `*_security_definer_function_executable` — `get_my_role`, `handle_new_user` va h.k. anon/authenticated tomonidan EXECUTE qilinadi. Bu ham dizayn bo'yicha (RLS funksiyalari). Tekshiruvni keyinroq qilamiz.
- **4 ta** — `extension_in_public` — `pg_trgm`, `pg_net` va h.k. `extensions` schema'ga ko'chirilishi mumkin. Risk past, keyinroq.

---

## 🚨 Rollback rejasi (agar nimadir xato bo'lsa)

| Muammo | Yechim |
|--------|--------|
| Migration buzilgan | `mcp__supabase__execute_sql` orqali manual ROLLBACK; yoki Supabase → Database → Backups |
| Caddy reload xato | `caddy validate --config /etc/caddy/Caddyfile` natijasiga qarang |
| API ishlamayapti | `pm2 logs clary-api --err`; environment variables tekshiring |
| Deploy qisman | `./deploy.sh <target>` alohida — masalan, `./deploy.sh api` |

---

**Tayyor.** Yuqoridagi qadamlarni tartib bo'yicha bajaring. Har bir bosqich tugagach, menga aytsangiz, men keyingi bosqichni boshlayman (web-patient booking yoki mobile flow).
