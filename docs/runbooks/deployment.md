# Deployment runbook

## Staging

Triggered automatically on push to `develop`:

1. GitHub Actions `deploy-staging.yml` runs
2. Supabase migrations are applied to the staging project
3. Dokploy webhook kicks off a rolling deploy of API + web apps on staging VPS

## Production

Triggered on a signed tag `v*.*.*`:

1. `deploy-production.yml` waits for manual approval (environment gate)
2. Supabase migrations applied to production project (`aoubdvlkcatbeifuysau`)
3. Dokploy deploys: API (rolling, 30s max per replica), then web apps (atomic swap)
4. Telegram notification to the founder channel

## Rollback

- API: Dokploy one-click rollback to previous image
- Web: previous `/var/www/<app>` kept; Caddy swap via symlink (<1s)
- DB: a paired `<timestamp>_*.down.sql` file is required for every migration; manual execution in a maintenance window only
