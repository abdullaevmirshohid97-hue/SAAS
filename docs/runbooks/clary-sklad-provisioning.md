# CLARY Sklad provisioning runbook

## Safety boundary

- This runbook is for CLARY Sklad only.
- Do not point `WAREHOUSE_DATABASE_ADMIN_URL` at the existing CLARY Clinic/Supabase database.
- The Clinic `clinics`, `profiles`, and existing migrations are not part of warehouse provisioning.
- The warehouse control-plane migration is additive but must be applied only after review and backup.
- No production database, DNS, or deployment action is performed by the feature branch.

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
3. BullMQ provisions a database and dedicated login using identifiers derived from the tenant UUID.
4. The tenant schema bootstrap runs only on that new database.
5. The database connection string is stored in Supabase Vault.
6. The tenant becomes `ACTIVE` only after schema bootstrap and registry update.
7. A failed job remains unavailable to tenant routes and may be retried from the warehouse API.

## Current implementation limits

- The initial data-plane schema includes product catalog, warehouses, stock ledger, customers, suppliers, purchase orders, sales orders, and audit events. It is a foundation, not a complete WMS/ERP.
- The initial Super Admin form requires an existing CLARY Auth user UUID. User invitation and email-based owner lookup are not implemented yet.
- DNS wildcard records and wildcard TLS must be configured separately by an authorized operator. This code does not change DNS.
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
