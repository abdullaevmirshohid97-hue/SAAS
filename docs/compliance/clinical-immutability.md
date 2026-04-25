# Clinical note immutability

Clinical notes (`treatment_notes`, `diagnostic_results` with `is_final = true`, `lab_results` with `is_final = true`) are **append-only** at the database level.

## SQL rules

```sql
CREATE RULE no_update_final_clinical_note AS
  ON UPDATE TO treatment_notes
  WHERE OLD.is_final = true
  DO INSTEAD NOTHING;

CREATE RULE no_delete_final_clinical_note AS
  ON DELETE TO treatment_notes
  WHERE OLD.is_final = true
  DO INSTEAD NOTHING;
```

## Amendment pattern

To correct a finalized note, we create a **new row** that references the old one via `amended_from_id` and includes an `amendment_reason`. The UI shows the whole chain.

## Rationale

- Medical-record law: doctors must not be able to silently edit patient history
- Audit trail for malpractice cases
