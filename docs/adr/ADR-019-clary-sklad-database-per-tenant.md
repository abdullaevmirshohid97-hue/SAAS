# ADR-019: CLARY Sklad — database per warehouse tenant

- Status: Accepted
- Date: 2026-11-24
- Scope: CLARY Sklad only. Existing CLARY Clinic behavior and schema remain unchanged.

## Context

CLARY Clinic currently uses the existing Supabase project, shared Postgres schema, Supabase Auth, and clinic_id-based row-level security. Its tenant lifecycle is implemented around the clinics table and set_user_clinic RPC.

CLARY Sklad requires a different isolation boundary: every warehouse company must have its own PostgreSQL database. Reusing the Clinic create-tenant flow or inserting warehouse tenants into public.clinics would couple the two products and risk changing Clinic behavior.

## Decision

1. Keep the current CLARY Clinic database, tables, migrations, authentication claims, and tenant lifecycle unchanged.
2. Use the existing Supabase Auth project as the shared identity provider.
3. Store only CLARY Sklad control-plane metadata in additive warehouse\_\* tables in the existing CLARY control-plane database.
4. Host all warehouse tenant databases on one dedicated PostgreSQL server initially. Each tenant gets:
   - a separate database;
   - a separate database role and password;
   - a connection secret stored in Supabase Vault;
   - an independent schema migration and backup/restore lifecycle.
5. The dedicated warehouse PostgreSQL server is configured through WAREHOUSE_DATABASE_ADMIN_URL. It must be a direct connection with CREATEDB and CREATEROLE privileges; a transaction pooler is not suitable for CREATE DATABASE.
6. Super Admin warehouse operations use separate /admin/warehouses endpoints and never call the existing /admin/tenants endpoints.
7. Warehouse provisioning runs asynchronously through BullMQ. Tenant status is not ACTIVE until database creation, schema bootstrap, and health verification succeed.
8. All changes are developed on a feature branch and reviewed in a pull request. No production migration, DNS change, database operation, or deployment is performed by this code change.

## Control plane

The existing Supabase database stores warehouse_tenants, warehouse_tenant_domains, warehouse_tenant_memberships, warehouse_tenant_databases, and warehouse_provisioning_events. These tables are RLS-enabled and inaccessible to anon/authenticated roles; the API service role is the only application access path.

## Data plane

The dedicated PostgreSQL server stores one database per warehouse tenant. The API resolves a tenant from its control-plane record and obtains the connection string from Supabase Vault. Database identifiers are generated from the immutable tenant UUID; user-supplied values are never used as SQL identifiers.

## Authentication and authorization

Supabase Auth remains the shared login system. Warehouse membership and warehouse-specific roles are stored separately from Clinic profiles. Warehouse routes must explicitly allow requests without clinic context and must verify the authenticated user’s membership in the selected warehouse tenant. A Clinic role or clinic_id must never grant warehouse access implicitly.

## Failure and recovery

Provisioning is idempotent and retryable. A failed tenant remains FAILED and is not routed to the data plane. Credentials are never logged or returned to clients. Tenant database deletion is not part of automatic retry or ordinary tenant suspension.

## Clinic safety invariants

- No changes to public.clinics, public.profiles, clinic RLS policies, or set_user_clinic.
- No changes to existing Clinic authentication or tenant creation behavior.
- No Clinic database migration is executed as part of warehouse provisioning.
- No production deploy or DNS update is triggered by the feature branch.
- CI must include Clinic regression tests and warehouse isolation/provisioning tests before merge.
