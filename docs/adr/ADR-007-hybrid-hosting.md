# ADR-007: Supabase Cloud + Hostinger VPS hybrid

- Status: Accepted

## Context

Trade-off between managed services (cost, speed-to-market) and control (data residency, cost at scale).

## Decision

- **Supabase Cloud** (`aoubdvlkcatbeifuysau.supabase.co`) — Postgres, Auth, Storage, Realtime, Edge Functions, Vault
- **Hostinger VPS** (Docker + Caddy + Dokploy) — NestJS API, Redis, BullMQ, Telegram backup worker, observability stack, static hosting for `clary.uz`/`app.clary.uz`/`admin.clary.uz`
- **Cloudflare** — DNS + WAF + Turnstile + free SSL cert on apex

## Consequences

- $25/mo Supabase Pro + $25-40/mo VPS = $50-65/mo operational floor
- All heavy compute (API, jobs, observability) is on VPS, bypassing Supabase egress fees
- Migration path to fully self-hosted Supabase exists if CIS regulators demand in-country data
