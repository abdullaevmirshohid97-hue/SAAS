# Clary v2

> Enterprise multi-tenant clinic management SaaS for Uzbekistan and CIS.

**Production URL**: <https://clary.uz> &middot; **App**: <https://app.clary.uz> &middot; **Admin**: <https://admin.clary.uz>

Clary v2 is a greenfield, catalog-driven, defense-in-depth multi-tenant SaaS for clinics, hospitals, diagnostic centers and dental practices. It ships with zero cross-tenant data leakage, offline-tolerant mobile, end-to-end type safety, dual-layer audit logging, and a world-class UI across web, mobile and (optionally) desktop.

## Highlights

- **Zero cross-tenant leakage** &mdash; 5-layer defense (Postgres RLS + JWT claims + NestJS TenantGuard + scoped Supabase client + audit)
- **Catalog-driven** &mdash; 25+ catalog tables, every operational setting is configurable by the clinic admin without developer intervention
- **Dual audit system** &mdash; real-time Activity Journal + tamper-evident Settings Audit Log (SHA-256 hash chain)
- **BYO credentials** &mdash; each clinic plugs in its own payment + SMS + email provider keys via Supabase Vault (pgsodium)
- **7 languages** &mdash; uz-Latn, uz-Cyrl, ru, kk, ky, tg, en with ICU MessageFormat
- **Subscription engine** &mdash; Demo / 25PRO / 50PRO / 120PRO with prorated upgrades, dunning, Stripe Checkout
- **Daily Telegram backup** &mdash; midnight summary + weekly B2 dump + failure alerts
- **Enterprise support chat** &mdash; real-time Supabase Realtime + delivered/read/typing + attachments + SLA
- **Marketing 2.0** &mdash; no-code segment builder, campaign wizard, A/B testing, drip journeys, loyalty program, NPS feedback loop
- **Healthcare compliance** &mdash; clinical note immutability, PII encryption, Persdata 547-son ready, GDPR-style
- **Lighthouse 100** &mdash; on the public landing page

## Monorepo structure

```
SAAS/
├── apps/
│   ├── api/              NestJS backend (port 4000)
│   ├── web-clinic/       Tenant web app (app.clary.uz)
│   ├── web-admin/        Super admin web app (admin.clary.uz)
│   ├── web-landing/      Public landing page (clary.uz / www.clary.uz)
│   ├── mobile/           Expo app (iOS + Android)
│   └── desktop/          Tauri wrapper (Phase 5+, optional)
├── packages/
│   ├── schemas/          Zod schemas (patients, appointments, billing...)
│   ├── types/            Supabase generated types + domain types
│   ├── api-client/       OpenAPI-generated SDK (shared by all frontends)
│   ├── ui-web/           shadcn/ui + Tailwind primitives
│   ├── ui-native/        NativeWind primitives for mobile
│   ├── i18n/             7-language translations (ICU MessageFormat)
│   ├── payments/         Payment provider adapters (Click, Payme, Uzum, Kaspi, Stripe...)
│   ├── notifications/    SMS/Email/Push adapters (Eskiz, Playmobile, Twilio, Resend...)
│   ├── tenant-vault/     BYO credentials via Supabase Vault
│   ├── config-eslint/    Shared ESLint config
│   ├── config-tsconfig/  Shared TypeScript configs
│   ├── config-tailwind/  Shared Tailwind preset + design tokens
│   └── utils/            Pure TS utilities (date, currency, phone, ...)
├── supabase/
│   ├── migrations/       Timestamped SQL migrations
│   ├── seed.sql          Dev/test seed
│   ├── functions/        Edge Functions (webhooks, AI proxies)
│   └── config.toml
├── infra/
│   ├── ansible/          VPS bootstrap playbooks
│   ├── caddy/            Caddyfile for all subdomains
│   ├── docker/           Docker Compose for local + VPS
│   ├── grafana/          Pre-built dashboards
│   └── telegram-bot/     Daily backup worker
├── tests/
│   ├── e2e-web/          Playwright specs
│   ├── e2e-mobile/       Detox specs
│   ├── rls/              Postgres RLS negative tests (pgTAP)
│   └── load/             k6 scripts
├── docs/
│   ├── architecture/
│   ├── adr/              Architecture Decision Records (18 ADRs)
│   ├── compliance/       Persdata, GDPR, 152-FZ docs
│   ├── legal/            ToS, Privacy, DPA, Cookie, SLA, AUP, EULA, Security
│   ├── runbooks/         Incident response, impersonation, DR
│   └── marketing/        Content calendar, brand guidelines
└── .github/workflows/    CI/CD pipelines
```

## Getting started

### Prerequisites

- Node.js >= 20.11.0
- pnpm >= 9.12.0
- Docker + Docker Compose
- Supabase CLI
- (Optional) Expo CLI for mobile

### Install

```bash
git clone https://github.com/abdullaevmirshohid97-hue/SAAS.git
cd SAAS
pnpm install
cp .env.example .env.local
# Fill in the required secrets (Supabase, Stripe, Eskiz, etc.)
```

### Start local dev (tested end-to-end)

**1. Start Supabase local stack** (first time takes ~5 min to pull images)

```powershell
# From repo root
node_modules\.pnpm\supabase@1.226.4\node_modules\supabase\bin\supabase.exe start
# or on Unix: npx supabase start
```

This brings up 11 containers: db, auth, storage, realtime, kong, studio, imgproxy,
edge-runtime, pg_meta, inbucket, rest. Migrations under `supabase/migrations/`
are applied automatically. The `seed.sql` file creates two demo clinics.

**2. Ensure Redis is running on `:6379`** (BullMQ dependency). Any local
Docker Redis works:

```powershell
docker run -d --name clary-redis -p 6379:6379 redis:7-alpine
```

**3. Seed dev users + sample data** (creates 5 auth users + catalog entries):

```powershell
node scripts/seed-dev-users.mjs
```

Credentials created:

| Email              | Password         | Role          | Use with      |
|--------------------|------------------|---------------|---------------|
| `founder@clary.uz` | `Founder!2026`   | super_admin   | web-admin     |
| `admin@nur.uz`     | `Admin!2026`     | clinic_admin  | web-clinic    |
| `admin@dmc.uz`     | `Admin!2026`     | clinic_admin  | web-clinic    |
| `doctor@nur.uz`    | `Doctor!2026`    | doctor        | web-clinic, mobile |
| `reception@nur.uz` | `Reception!2026` | receptionist  | web-clinic    |

**4. Start the API** (NestJS, port 4000). `.env.local` must be loaded
via shell export before `node dist/main.js`:

```powershell
pnpm -F @clary/api build
Get-Content .env.local | ForEach-Object { if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') } }
node apps/api/dist/main.js
```

**5. Start the web apps (each in its own terminal)**:

```powershell
pnpm -F @clary/web-clinic  dev        # :5173
pnpm -F @clary/web-admin   dev        # :5174  (pass --port 5174 if needed)
pnpm -F @clary/web-landing dev        # :4321
```

**6. (Optional) mobile** via Expo — requires Android/iOS tooling:

```powershell
pnpm -F @clary/mobile start
```

### URLs (local)

| App              | URL                     | Description                   |
|------------------|-------------------------|-------------------------------|
| API              | <http://localhost:4000> | NestJS backend                |
| Web Clinic       | <http://localhost:5173> | Tenant app                    |
| Web Admin        | <http://localhost:5174> | Super admin app               |
| Web Landing      | <http://localhost:4321> | Public marketing site (Astro) |
| Swagger docs     | <http://localhost:4000/api/docs> | OpenAPI 3.1 interactive docs |
| Supabase Studio  | <http://localhost:54323>| Local Supabase                |
| Inbucket (email) | <http://localhost:54324>| Local email preview           |

### Verified end-to-end smoke test

The following flow has been verified in the browser:

1. **Landing** (`localhost:4321`) — hero, 4 pricing tiers, FAQ all render
2. **Web-clinic login** (`localhost:5173/login`) — sign in as `admin@nur.uz`
3. **Dashboard** — sidebar with 12 modules (Reception, Queue, Diagnostics, Lab,
   Pharmacy, Inpatient, Cashier, Journal, Analytics, Marketing, Settings),
   KPI cards, Cmd+K palette, onboarding checklist
4. **Settings → Catalogs** — 15 catalog tabs (Services, Rooms, Diagnostics,
   Equipment, Lab tests, Medications, Discounts, Payment methods, Insurance,
   Referral partners, SMS/Email/Document templates)
5. **Web-admin login** (`localhost:5174`) — sign in as `founder@clary.uz`
6. **Tenants list** — two seeded tenants render with their plan & status
7. **API health** — `GET http://localhost:4000/api/v1/health` returns `{status:"ok"}`
8. **API auth** — unauthenticated requests to protected routes return 401

## Subdomains (production)

| Subdomain                | Purpose                                    |
|--------------------------|--------------------------------------------|
| `clary.uz`               | Public landing (canonical)                 |
| `www.clary.uz`           | 301 redirect to clary.uz                   |
| `app.clary.uz`           | Tenant web app                             |
| `admin.clary.uz`         | Super admin web app                        |
| `api.clary.uz`           | NestJS API                                 |
| `realtime.clary.uz`      | Supabase Realtime proxy                    |
| `storage.clary.uz`       | Supabase Storage proxy                     |
| `auth.clary.uz`          | Supabase Auth proxy                        |
| `cdn.clary.uz`           | Static assets                              |
| `status.clary.uz`        | Public status page (Uptime Kuma)           |
| `docs.clary.uz`          | API docs (Scalar / Swagger UI)             |
| `grafana.clary.uz`       | Internal monitoring (IP allowlist)         |
| `glitchtip.clary.uz`     | Internal error tracking                    |
| `dokploy.clary.uz`       | Internal deployment dashboard              |

## Testing

```bash
pnpm test:unit           # Vitest unit tests (target: 85% coverage)
pnpm test:integration    # NestJS integration against seeded DB
pnpm test:rls            # pgTAP RLS negative tests (must pass zero leaks)
pnpm test:e2e            # Playwright cross-app E2E
pnpm -F @clary/mobile test:e2e  # Detox mobile E2E
pnpm -F @clary/tests-load k6-run # k6 load tests
```

## Deployment

See [docs/runbooks/deployment.md](docs/runbooks/deployment.md) for the full VPS + Supabase Cloud deployment runbook.

## License

Copyright (c) 2026 Clary LLC. All rights reserved. See [LICENSE](LICENSE).

## Legal

- [Terms of Service](docs/legal/terms.md)
- [Privacy Policy](docs/legal/privacy.md)
- [DPA](docs/legal/dpa.md)
- [Cookie Policy](docs/legal/cookies.md)
- [SLA](docs/legal/sla.md)
- [Acceptable Use Policy](docs/legal/aup.md)
- [Security Disclosure](docs/legal/security-disclosure.md)
- [EULA (mobile)](docs/legal/eula.md)

## Contact

- General: hello@clary.uz
- Sales: sales@clary.uz
- Support: support@clary.uz
- Security: security@clary.uz
- Legal: legal@clary.uz
