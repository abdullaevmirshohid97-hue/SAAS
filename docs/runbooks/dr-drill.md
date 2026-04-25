# Disaster recovery drill (quarterly)

## Goals

- Verify RPO (recovery point) is less than 5 minutes (Supabase PITR)
- Verify RTO (recovery time) is less than 2 hours for full restore

## Procedure

1. Pick a staging snapshot (e.g. this morning)
2. Simulate total loss — spin up a fresh Supabase project
3. Restore via PITR or the weekly `pg_dump`
4. Redeploy API + web apps pointing to the new DB
5. Run smoke tests
6. Record RTO / RPO in `docs/runbooks/dr-drill-YYYY-MM-DD.md`

## Cadence

Every calendar quarter. Missing a drill is an S2 incident.
