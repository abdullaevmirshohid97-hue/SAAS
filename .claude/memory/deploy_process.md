---
name: deploy-process
description: "Clary production deploy jarayoni — host Caddy (statik /var/www) + pm2 API, Docker EMAS"
metadata: 
  node_type: memory
  type: project
  originSessionId: 10d0df07-9d29-4572-a47f-bf5f8e147e96
---

# Clary Production Deploy (HAQIQIY usul)

**Server:** Hostinger VPS, `/opt/clary`, root SSH. Host Node **v20.20.2**.

## Arxitektura (2026-05-30 da aniqlandi)
Production **Docker EMAS** — **host'da to'g'ridan-to'g'ri Caddy** (systemd) statik fayllarni server qiladi + **pm2** API'ni yuritadi:

- `app.clary.uz`   → `/var/www/app`     (web-clinic statik build) — **mijoz/klinika**
- `admin.clary.uz` → `/var/www/admin`   (web-admin statik build) — **super admin**
- `clary.uz`       → `/var/www/landing` (web-landing) — **landing**
- `patient.clary.uz` → `/var/www/patient`
- `api.clary.uz`   → `reverse_proxy localhost:4000` (**pm2: clary-api**)

Caddyfile: `/etc/caddy/Caddyfile` (host systemd Caddy, port 80/443 egasi).

## Deploy buyruqlari

**Frontend (web-clinic / app.clary.uz):**
```bash
cd /opt/clary && \
git pull && \
pnpm install && \
pnpm --filter @clary/web-clinic build && \
rm -rf /var/www/app/* && \
cp -r apps/web-clinic/dist/* /var/www/app/
```

**Backend (API):**
```bash
cd /opt/clary && pnpm --filter @clary/api build && pm2 restart clary-api
```

**web-admin → `/var/www/admin`**, **web-landing → `/var/www/landing`** (xuddi shu pattern).

Deploy'dan keyin brauzerda **Ctrl+Shift+R** (eski JS bundle cache).

## MUHIM ogohlantirishlar (vaqt yo'qotmaslik uchun)
- **Docker ishlatma!** `infra/docker/docker-compose.prod.yml` bor, lekin production'da ISHLATILMAYDI. Docker Caddy host Caddy bilan port 80 da urishadi (`address already in use`). Docker — eski/tashlandiq tajriba.
- **`pm2 restart` faqat API'ni yangilaydi**, frontend'ga TEGMAYDI. Frontend = `/var/www/app` ga `cp`.
- Server `docker-compose` **v1.29.2** (eski) — `name:` maydonini qo'llamaydi, `KeyError: ContainerConfig` bug beradi. Baribir kerak emas.
- DB migration'lar Supabase managed (MCP `apply_migration`) — serverda alohida shart emas.
- Frontend build host Node 20.19+ talab qiladi (`sitemap` engine). Host'da 20.20.2 bor — OK.

**Why:** 2026-05-30 deploy'da men noto'g'ri (Docker, keyin pm2-only) yo'ldan ketib ko'p vaqt yo'qotdim. Asl usul — Caddy statik papka + pm2.
**How to apply:** Frontend o'zgarsa → build + `/var/www/<app>` ga cp. Backend o'zgarsa → build + pm2 restart. Hech qachon Docker compose ishlatma.
