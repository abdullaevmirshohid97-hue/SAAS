# ADR-002: Multi-tenant isolation — defense in depth

- Status: Accepted

## Context

Zero cross-tenant data leakage is a non-negotiable constraint. A bug in any single layer must not be able to expose Clinic A's data to Clinic B.

## Decision

Five independent layers:

1. **Postgres RLS** — every domain table has `clinic_id UUID NOT NULL` and policies `USING (clinic_id = get_my_clinic_id() OR get_my_role() = 'super_admin')`
2. **JWT claims** — injected at login by a Supabase auth trigger into `app_metadata`; not user-editable
3. **NestJS TenantGuard** — re-verifies `clinic_id` from JWT, attaches to `RequestContext` (AsyncLocalStorage)
4. **Scoped Supabase client** — API forwards user JWT to PostgREST; service-role key is used only in explicit admin handlers
5. **Audit + negative tests** — every mutation logs before/after; pgTAP tests try to access another clinic's data and must return zero rows (fails the build)

## Consequences

- A bug in any one layer is masked by the others
- pgTAP negative tests block PRs that weaken RLS
- `super_admin` impersonation uses a short-lived token with `impersonated_by` claim visible in the target clinic's UI
