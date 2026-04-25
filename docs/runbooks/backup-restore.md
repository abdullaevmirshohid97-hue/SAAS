# Backup and restore runbook

## Backups

1. **Supabase PITR** — 7 days built-in (Pro plan). Automatic.
2. **Weekly `pg_dump`** — encrypted with `age`, uploaded to Backblaze B2 bucket `clary-backups/weekly/`.
3. **Daily Telegram summary** — the `telegram-bot` worker runs at 00:00 Asia/Tashkent with counts of new rows, backup status, queue depth.

## Restore test (quarterly DR drill)

```bash
# 1. Fetch the latest weekly dump
aws s3 cp s3://clary-backups/weekly/latest.sql.age /tmp/restore.sql.age

# 2. Decrypt
age -d -i ~/.age/clary-backup-key.txt -o /tmp/restore.sql /tmp/restore.sql.age

# 3. Restore into a throwaway Supabase project
psql "$STAGING_DB_URL" -f /tmp/restore.sql

# 4. Run smoke tests
pnpm -F @clary/tests-e2e-web test --grep '@smoke'

# 5. Document RTO (actual restore time) in docs/runbooks/dr-drill-YYYY-MM-DD.md
```
