# Hostinger VPS — Clary Docker Setup

**One-time setup** for a fresh Hostinger VPS (Ubuntu 22.04 / 24.04). After this, every deploy is just `./deploy-docker.sh`.

## 0. Pre-flight (Hostinger panelda)

1. **VPS yarating** (yo'q bo'lsa) — kamida 2 vCPU + 4GB RAM tavsiya etiladi
2. **DNS qaydlari** (Hostinger DNS panel yoki Cloudflare):
   ```
   A     clary.uz          → <VPS_IP>
   A     www.clary.uz      → <VPS_IP>
   A     app.clary.uz      → <VPS_IP>
   A     api.clary.uz      → <VPS_IP>
   A     admin.clary.uz    → <VPS_IP>
   ```
3. **Firewall** — Hostinger panelda 22, 80, 443 portlarni ochish
4. **SSH** kalit qo'shish (parolli kirishni o'chirish tavsiya etiladi)

## 1. SSH bilan kirish

```bash
ssh root@<VPS_IP>
```

## 2. Tizimni yangilash

```bash
apt update && apt upgrade -y
apt install -y git curl ufw
```

## 3. Docker o'rnatish

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker --version
docker compose version
```

## 4. Firewall (UFW)

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

## 5. Loyihani klonlash

```bash
mkdir -p /opt
cd /opt
git clone https://github.com/<your-username>/SAAS.git clary
cd clary
git checkout main
```

> **Eslatma:** Repo private bo'lsa: `git clone git@github.com:...` (avval VPS'ga SSH kalit qo'shing yoki PAT bilan HTTPS).

## 6. Production env

```bash
cp .env.production.example .env.production
nano .env.production   # barcha qiymatlarni to'ldiring
```

Random secret yaratish:
```bash
openssl rand -hex 32
```

Quyidagi 4 ta secret uchun har birini alohida ishlatib, qiymatlarni `.env.production` ga yozing:
- `REDIS_PASSWORD`
- `CRON_SECRET`
- `DEMO_IP_SALT`
- `LEADS_IP_SALT`

## 7. Supabase migrations

Mahalliy kompyuterdan (yoki Supabase Dashboard'dan):

1. **Supabase Dashboard** → SQL Editor
2. `supabase/manual-apply-v1.sql` faylini paste qiling
3. **Run** bosing
4. `✅ Clary v1.0 migrations applied successfully` ko'rishingiz kerak

## 8. Deploy script ishga tushirish

```bash
chmod +x deploy-docker.sh
./deploy-docker.sh
```

Birinchi marta ~5-10 daqiqa oladi (image'lar build bo'ladi). Caddy avtomatik Let's Encrypt sertifikatini oladi.

## 9. Tekshirish

```bash
./deploy-docker.sh status
```

Brauzerdan tekshirish:
- https://clary.uz — landing
- https://app.clary.uz/login — clinic
- https://api.clary.uz/health — `{"status":"ok"}` qaytarishi kerak
- https://api.clary.uz/api/docs — Swagger

## 10. Demo'ni sinab ko'rish

Brauzerdan https://clary.uz/demo — 5 sekundda demo dashboard ochilishi kerak.

---

## Kundalik foydalanish

```bash
cd /opt/clary

# Yangi versiyani deploy qilish
./deploy-docker.sh

# Loglarni ko'rish
./deploy-docker.sh logs api
./deploy-docker.sh logs caddy

# Bitta service'ni restart qilish
./deploy-docker.sh restart api

# Container holati
./deploy-docker.sh status
```

## GitHub'dan auto-deploy (ixtiyoriy)

GitHub Actions yoki webhook orqali har push'da auto-deploy qilish uchun, VPS'da:

```bash
# /opt/clary/deploy-on-push.sh
#!/bin/bash
cd /opt/clary
./deploy-docker.sh
```

GitHub webhook → VPS'da kichik HTTP listener (yoki Coolify/CapRover ishlatish ham mumkin).

---

## Troubleshooting

### "Caddy can't get certificate"
- DNS to'g'ri ishlayotganini tekshiring: `dig clary.uz`
- 80/443 portlar ochiqligini tekshiring: `ufw status`
- Caddy loglari: `./deploy-docker.sh logs caddy`

### "API container restarting"
- Env to'liqligini tekshiring: `cat .env.production | grep -v '^#' | grep -v '^$'`
- API logs: `./deploy-docker.sh logs api`
- Eng ko'p sabab — `SUPABASE_SERVICE_ROLE_KEY` noto'g'ri yoki yo'q

### "Demo spawn 500 error"
- Supabase'da `spawn_demo_workspace` funksiyasi bormi: SQL Editor'da
  ```sql
  SELECT * FROM spawn_demo_workspace(NULL, 24);
  ```
- Agar yo'q bo'lsa — `manual-apply-v1.sql` ni qayta run qiling

### "Out of disk space"
```bash
docker system prune -af --volumes
```

### Backup
- Supabase PITR avtomatik (ehtiyot bo'lib backup'larni Dashboard'dan tekshiring)
- VPS'da faqat Redis volume bor — agar yo'qolsa, demo cache'lar tiklanadi

---

## Resurslar

- VPS yuk: ~1.5GB RAM idle, ~3GB peak under load
- Disk: ~3GB images + logs (haftada 1 marta `docker system prune -f`)
- CPU: idle, build paytida 100% (~5 daq)
