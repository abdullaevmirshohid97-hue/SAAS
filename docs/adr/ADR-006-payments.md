# ADR-006: Payment adapter (dual-mode)

- Status: Accepted

## Context

Two very different payment flows:

1. **Platform subscription** — Clary charges clinics via Stripe (platform's own merchant account)
2. **Clinic-customer payments** — the clinic's patients pay the clinic through Click / Payme / Uzum / Kaspi / Humo / Uzcard / Apelsin / Visa Direct with the clinic's own merchant credentials (BYO)

## Decision

Single `PaymentAdapter` interface (`charge`, `refund`, `verify-webhook`), implemented per provider. A `mode: 'platform' | 'tenant'` flag selects the credential source (platform env vars vs `tenant_vault_secrets`).

## Consequences

- Adding a new provider is an `./payments/providers/<new>.ts` file
- Webhooks are idempotent (per-provider reference ID) and retry-safe
- Failed webhooks go to a DLQ after 10 retries; alert fires
- Clinic never needs to hand their merchant credentials to Clary in plain text
