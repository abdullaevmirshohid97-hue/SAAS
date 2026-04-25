# Data residency

See [ADR-010](../adr/ADR-010-data-residency.md) for the full decision rationale.

## Current state (pilot)

- Primary database: Supabase Cloud, AWS eu-west-1 (Ireland)
- Backups: Backblaze B2, us-west-4 (age-encrypted)
- CDN: Cloudflare (global)

## Migration plan (if regulators require)

- Target: self-hosted Supabase on Uzcloud / Uzinfocom VPS in Tashkent
- Estimated migration window: 6 hours maintenance
- Rehearsed quarterly
