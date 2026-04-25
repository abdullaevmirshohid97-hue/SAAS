# Schema rollback

Every forward migration must have a paired down migration:

```
supabase/migrations/
  20260423_001_add_patient_tags.sql
  20260423_001_add_patient_tags.down.sql
```

## Rollback steps

1. **Announce maintenance** window via status page
2. Drain connections: scale API to 0 replicas via Dokploy
3. Run the `.down.sql` manually:
   ```bash
   psql "$DATABASE_URL" -f supabase/migrations/20260423_001_add_patient_tags.down.sql
   ```
4. Deploy the previous API image
5. Scale API back to desired replicas
6. Verify via smoke tests
