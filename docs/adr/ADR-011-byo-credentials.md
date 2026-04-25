# ADR-011: BYO credentials via Supabase Vault

- Status: Accepted

## Context

Each clinic wants to use its OWN SMS / payment / email provider API keys so that payments flow directly to the clinic's bank, and SMS costs come out of the clinic's provider balance.

## Decision

- Table: `tenant_vault_secrets` (clinic_id, provider_kind, provider_name, is_primary, label, created_at, ...)
- Actual secret values stored via `pgsodium` + Supabase Vault (encrypted at rest with a per-project key)
- CRUD via Settings UI (Integrations page) with a "Test connection" button before saving
- Supports PRIMARY and FALLBACK providers per kind (e.g. Eskiz primary, Playmobile fallback)
- Secrets are never returned in list responses; the UI shows `eskiz****1234` masks

## Consequences

- Clinic owns its money flow and SMS costs
- Clary never has the plain-text secret on disk or in logs
- Super admin can see that a secret exists but cannot read the value
