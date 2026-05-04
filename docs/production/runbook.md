# Clary — Incident Runbook

For on-call. Read top to bottom in an incident; copy-paste commands as you go.

## Severity scale

- **Sev 1** — full outage (api down, signup broken). Page everyone, declare in #incident.
- **Sev 2** — partial degradation (slow, one feature broken). Page on-call.
- **Sev 3** — minor (UI glitch, single tenant). File ticket, fix next day.

## Common incidents

### API 5xx spike

1. Check Sentry: project `clary-api`, last 30 min
2. Check Supabase advisor + logs (look for migration recent)
3. If a deploy went out in the last hour: **roll back via the deploy platform** (Vercel/Render/whatever) before debugging
4. If DB connection saturated: bump pool / restart pgBouncer
5. If single endpoint: feature-flag it off

### Signup / onboarding broken

1. Check `/api/v1/auth/onboarding` Sentry breadcrumbs
2. Check Supabase RLS for `clinics`, `profiles` tables (recent advisor)
3. Try signup yourself in incognito; capture the failing request id from network tab
4. If `set_user_clinic` RPC error → check pg_log for function definition mismatch

### Demo spawn 500s

1. Check `/api/v1/demo/spawn` Sentry
2. Check `spawn_demo_workspace` RPC manually:
   ```sql
   SELECT * FROM spawn_demo_workspace(NULL, 24);
   ```
3. If `demo_spawn_log` insert fails — RLS regression, check policies
4. If magic link fails — Supabase Auth admin API key rotated?

### Leads not arriving in Telegram

1. Try POSTing manually:
   ```bash
   curl -X POST https://api.clary.uz/api/v1/leads \
     -H "Content-Type: application/json" \
     -d '{"phone":"+998901234567","source":"runbook_test"}'
   ```
2. Check `leads` table for the new row (service-role only)
3. If row exists but no Telegram msg: verify `TELEGRAM_LEADS_BOT_TOKEN` and chat id; check bot still in chat

### High Sentry error rate (clinic)

1. Filter by clinic_id — single tenant or all?
2. If all: most likely a deploy regression, roll back
3. If one tenant: check their custom data (e.g., empty services, malformed clinic settings)

## Rollback procedure (api)

1. Identify last green commit on `main`
2. Revert via deploy platform UI **before** trying to git revert
3. After rollback stabilizes, open a `revert/<sha>` branch with the actual revert commit
4. Run tests, deploy through normal pipeline

## Rollback procedure (db)

NEVER drop a column or table to undo a bad migration in production.

1. Write a forward-fix migration (`down` is irreversible in our setup)
2. Apply via `supabase db push` to staging first
3. Promote to prod after smoke test

## Escalation

- DB / data integrity → Mirshohid + Supabase support
- Auth / security → Mirshohid + rotate keys immediately
- Payment / billing → freeze payouts, notify finance, then investigate
- Public outage > 30 min → status page update + tweet/Telegram

## After every incident

1. Open postmortem doc within 48h
2. Add a row to `docs/production/postmortems/YYYY-MM-DD-<title>.md`
3. Add an item to launch checklist if a guardrail was missing
