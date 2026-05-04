# Clary Production Launch Checklist

Run through this *every* major release. Box ☐ = open, ☑ = done.

## Infra & secrets

- ☐ All `.env` secrets rotated within last 90 days
- ☐ `SUPABASE_SERVICE_ROLE_KEY` not exposed to any frontend
- ☐ `CRON_SECRET`, `DEMO_IP_SALT`, `LEADS_IP_SALT` set in prod
- ☐ `TELEGRAM_LEADS_BOT_TOKEN` + `TELEGRAM_LEADS_CHAT_ID` configured
- ☐ Sentry DSN set for api, web-clinic, web-landing (separate projects)
- ☐ PostHog keys: `PUBLIC_POSTHOG_KEY` (landing), `VITE_POSTHOG_KEY` (clinic)
- ☐ Microsoft Clarity ID: `PUBLIC_CLARITY_ID` (landing only)
- ☐ DNS: clary.uz (landing), app.clary.uz (clinic), api.clary.uz, status.clary.uz

## Database

- ☐ Latest migrations applied (`supabase db push`)
- ☐ RLS enabled on every table (Supabase advisor 0 warnings)
- ☐ PITR backup enabled, last successful restore test < 30 days
- ☐ `cleanup_expired_demos()` cron scheduled (hourly)
- ☐ Connection pooling on (PgBouncer / Supavisor)

## API

- ☐ Helmet CSP active, `securityheaders.com` grade A or A+
- ☐ Rate limits: public 100/min, auth check-slug 20/min, demo spawn 3/h, leads 5/min
- ☐ `/health` returns 200 with DB + Redis check
- ☐ Swagger `/api/docs` gated or hidden in prod (or kept public if intentional)
- ☐ CORS origins explicit (no wildcard)
- ☐ Source maps uploaded to Sentry on deploy

## Frontend (clinic)

- ☐ `vite build` clean, no warnings
- ☐ Vendor chunks split (supabase, query, i18n)
- ☐ PWA manifest installable (Chrome "Install" prompt visible)
- ☐ Demo banner visible when `clinic.is_demo`
- ☐ Onboarding checklist appears for new tenants
- ☐ Dashboard loads < 3s on fast 4G (Lighthouse mobile)

## Frontend (landing)

- ☐ Lighthouse mobile Performance ≥ 90, SEO ≥ 95
- ☐ Sitemap reachable at `/sitemap.xml` and submitted to Google + Bing
- ☐ JSON-LD validates: Organization, SoftwareApplication, Product, FAQPage, Article (blog), Review (testimonials)
- ☐ Cookie consent banner shows on first visit, opt-out actually disables PostHog
- ☐ Exit-intent fires once per browser, leads land in Telegram + DB

## Compliance & legal

- ☐ Privacy policy reviewed by legal (UZ Persdata 547-son)
- ☐ Terms of Service in UZ + RU + EN
- ☐ Data Processing Agreement (DPA) template downloadable
- ☐ Cookie policy lists every cookie + purpose
- ☐ Right-to-erasure endpoint tested

## Monitoring

- ☐ Sentry alerts wired to Telegram/Slack
- ☐ Uptime check on api.clary.uz, app.clary.uz, clary.uz (≤ 1 min interval)
- ☐ Status page (status.clary.uz) public
- ☐ PostHog funnel dashboard saved: landing → demo → signup → first_queue
- ☐ Clarity heatmaps reviewed weekly first month

## Communication

- ☐ Launch email template ready (existing leads list)
- ☐ Telegram channel post drafted (UZ + RU)
- ☐ LinkedIn / Facebook founder post drafted
- ☐ Producthunt-style "What's new" page ready
- ☐ On-call rotation defined for launch week
- ☐ Rollback plan documented for every critical service

## After launch (first 7 days)

- Daily: check Sentry, PostHog funnel, Telegram leads, Status uptime
- Day 3: review heatmaps for unexpected behavior
- Day 7: run retro — what broke, what worked, what to fix in S13
