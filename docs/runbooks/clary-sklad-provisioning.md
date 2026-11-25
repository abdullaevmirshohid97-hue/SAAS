# CLARY Sklad provisioning runbook

## Safety boundary

- This runbook is for CLARY Sklad only.
- Do not point `WAREHOUSE_DATABASE_ADMIN_URL` at the existing CLARY Clinic/Supabase database.
- The Clinic `clinics`, `profiles`, and existing migrations are not part of warehouse provisioning.
- The warehouse control-plane migration is additive but must be applied only after review and backup.
- No production database, DNS, or deployment action is performed by the feature branch.

## Process isolation (C0)

- Sklad runs as a **separate Nest app and pm2 process**: `apps/api/src/sklad-main.ts` → `SkladAppModule`, pm2 name `clary-sklad-api`, `127.0.0.1:4100`.
- The Clinic API (`app.module.ts`, pm2 `clary-api`, port 4000) does **not** import `WarehouseModule`; no Clinic guard (auth/tenant/subscription/entitlements/pharmacy/permissions) is modified for Sklad.
- Shared: Supabase identity (JWT check — `AuthGuard`) and the control-plane tables in the Clinic Supabase project (additive migration).
- Caddy routes `sklad.clary.uz` and `*.sklad.clary.uz` to 4100 with the original Host (tenant is resolved from Host). See `infra/caddy/sklad.Caddyfile.snippet`.
- Deploy: `scripts/deploy-sklad.sh` (never touches `clary-api`).

## Required configuration

Set these variables only in the API server secret store:

- `WAREHOUSE_DATABASE_ADMIN_URL`: direct connection to a dedicated PostgreSQL server, database `postgres`, provisioner role with `CREATEDB` and `CREATEROLE`.
- `WAREHOUSE_DATABASE_SSLMODE=require` for TLS (default behavior).
- `WAREHOUSE_DATABASE_REJECT_UNAUTHORIZED=true` unless a properly managed internal CA is configured.
- `WAREHOUSE_TENANT_POOL_MAX=5` as an initial per-tenant connection cap.
- `WAREHOUSE_BASE_DOMAIN=sklad.clary.uz`.

Never add real credentials to Git or frontend environment variables.

## Provisioning lifecycle

1. Super Admin submits a warehouse tenant with an existing CLARY Auth user UUID as owner.
2. API creates the warehouse control-plane records through `create_warehouse_tenant`.
3. The Sklad API queue worker (every 15 s, control-plane table + `claim_warehouse_provisioning`, no Redis) provisions a database and dedicated login using identifiers derived from the tenant UUID.
4. The tenant schema bootstrap runs only on that new database.
5. The database connection string is stored in Supabase Vault.
6. The tenant becomes `ACTIVE` only after schema bootstrap and registry update.
7. A failed attempt is retried automatically with backoff (15 s → 15 min, max 5 attempts); after that the tenant is `FAILED` and Super Admin can press "Qayta urinish". The full error is only in the Sklad API server log (redacted).

## Current implementation limits

- The initial data-plane schema includes product catalog, warehouses, stock ledger, customers, suppliers, purchase orders, sales orders, and audit events. It is a foundation, not a complete WMS/ERP.
- The initial Super Admin form requires an existing CLARY Auth user UUID. User invitation and email-based owner lookup are not implemented yet.
- DNS: ahost.uz panel rejects `*.sklad` — use per-tenant A records (`<slug>.sklad`) or delegate `sklad.clary.uz` via NS to a DNS provider with wildcard support. TLS: Caddy `on_demand_tls` with `ask http://127.0.0.1:4100/api/v1/tls-allowed` (only registered tenant hosts get certificates).
- The API currently exposes warehouse context and a read-only products endpoint. Business CRUD workflows are later milestones.
- Backup automation, database-server sharding, billing integration, and tenant deletion workflows are not implemented in this first slice.

## Validation before any production use

- Apply the warehouse control-plane migration to a disposable staging copy first.
- Configure a dedicated non-production warehouse PostgreSQL server.
- Create two test tenants and verify distinct database names, roles, Vault secrets, and host mappings.
- Verify a user without warehouse membership receives 403.
- Verify a Clinic user does not gain warehouse access from their Clinic role or clinic_id.
- Verify the existing Clinic signup, login, Super Admin tenant creation, patient workflow, and Clinic migration checks.
- Restore one warehouse database from backup and verify Clinic remains unaffected.
- Review the PR and CI results before merge. Production deployment requires a separate explicit approval.
