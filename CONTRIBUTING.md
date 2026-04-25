# Contributing to Clary v2

## Development workflow

```bash
pnpm install
cp .env.example .env.local
pnpm -F @clary/supabase start
pnpm dev          # runs api + web-clinic + web-admin + web-landing in parallel
```

## Branching

- `main` — production
- `develop` — staging
- `feat/<short-description>` — feature branches (rebase before merge)
- `fix/<short-description>` — bug fixes
- `chore/<short-description>` — tooling / config

PRs require one review. Branch protection enforces CI green before merge.

## Commit messages

Conventional Commits:

```
feat(patients): add insurance fields
fix(billing): correct UZS rounding
chore(deps): bump zod to 3.23.8
docs(adr): add ADR-016 licensing
```

## Tests gate

- `pnpm lint` (zero warnings)
- `pnpm typecheck`
- `pnpm test:unit` (>= 85% coverage)
- `pnpm test:integration`
- `pnpm test:rls` (RLS negative must be 100% green)

All must pass before merging.

## Schema migrations

```bash
pnpm -F @clary/supabase new-migration <name>
# Edit supabase/migrations/<ts>_<name>.sql AND <ts>_<name>.down.sql
```

- Every forward migration requires a paired down migration
- CI runs migrations against a fresh Postgres in the pipeline
- RLS negative tests re-run automatically

## Secrets

- Never commit `.env.local`, `.env.production`, or any file containing real secrets
- Use GitHub Actions secrets (see `.github/workflows/*.yml` for keys)
- Rotate secrets quarterly

## Code style

- Prettier + ESLint configured in `packages/config-eslint`
- Pre-commit hook runs `lint-staged`
- TypeScript `strict` + `noUncheckedIndexedAccess` on everywhere

## Reporting security issues

Email <security@clary.uz>. Do NOT open a public issue. See [SECURITY DISCLOSURE](docs/legal/security-disclosure.md).
