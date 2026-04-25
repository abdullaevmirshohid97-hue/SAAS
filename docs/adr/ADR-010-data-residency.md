# ADR-010: Data residency and migration path

- Status: Accepted (pilot), Re-evaluate after 6 months

## Context

Uzbekistan 547-son and Russia 152-FZ prefer in-country storage of personal data. Supabase Cloud hosts in AWS (us-east, eu-west, etc.).

## Decision

- Pilot phase: use Supabase Cloud EU (closest latency for CIS), document this risk in the DPA
- Production plan: if regulatory pressure forces localization, migrate to self-hosted Supabase on a Tashkent-based VPS (provider: Uzcloud / Uzinfocom)
- All migrations tested in staging before production

## Consequences

- The DPA explicitly discloses data residency and gives clinics a 90-day notice of any change
- Self-hosted migration path is smoke-tested quarterly
