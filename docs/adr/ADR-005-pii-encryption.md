# ADR-005: PII column-level encryption

- Status: Accepted

## Context

Uzbekistan 547-son (Persdata) and Russian 152-FZ require that personal data is encrypted at rest. Supabase Cloud encrypts the storage volume, but we want defense in depth.

## Decision

- `pgsodium` extension + Supabase Vault for column-level encryption
- Encrypted columns: `patients.id_number`, `patients.phone`, `profiles.phone`, `profiles.full_name` (optional), all `tenant_vault_secrets.value`
- Keys rotated quarterly
- Search on encrypted columns via `pg_trgm` on deterministic hash prefix (for phone numbers) + exact match on `sha256(id_number)`

## Consequences

- A database dump alone cannot reveal PII without the Vault keys
- `super_admin` cannot trivially query PII without an audit trail
- Slight overhead on insert/update (~1-2 ms per row)
