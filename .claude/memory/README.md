# Clary loyiha xotirasi (skill/memory)

Bu papka Claude Code uchun loyiha bilimini saqlaydi — arxitektura, featurelar, kritik
kashfiyotlar. Boshqa kompyuterda ishni davom ettirish uchun:

1. `git pull` qiling (bu fayllar repo bilan keladi).
2. Bu fayllarni Claude'ning global memory papkasiga ko'chiring:
   `~/.claude/projects/d--SAAS/memory/` (yoki sizdagi loyiha kaliti bilan).
   - Windows: `C:\Users\<user>\.claude\projects\d--SAAS\memory\`
3. `MEMORY.md` — indeks (har sessiyada yuklanadi). Qolgan `.md` fayllar — alohida bilimlar.

## Fayllar
- `MEMORY.md` — indeks (har biriga bir qatorlik ko'rsatkich)
- `clary_app_skill.md` — TO'LIQ loyiha skill (arxitektura, modullar, DB, oqimlar, baglar)
- `deploy_process.md` — deploy (host Caddy + pm2, Docker EMAS)
- `data_admin_feature.md` — Xavfli zona (hard-delete + undo)
- `payroll_smart.md` — aqlli maosh tizimi
- `features_2026_05_31.md` — kassa/statsionar/analitika featurelar
- `inpatient_feature.md` — statsionar
- `project_roadmap.md`, `auth_strategy.md` — yo'l xaritasi va auth
