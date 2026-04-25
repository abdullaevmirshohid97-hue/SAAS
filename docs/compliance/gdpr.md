# GDPR compliance summary

## Lawful basis

- **Contract** — performance of the clinic's service agreement with patients
- **Legal obligation** — medical record retention (country-specific)
- **Legitimate interest** — product analytics (cookieless only)

## Rights we support

| Right               | How                                            |
|---------------------|------------------------------------------------|
| Access              | Patient-facing export via the clinic           |
| Rectification       | Clinic edits records in the app                |
| Erasure             | `DELETE /patients/:id` soft-deletes; 90d hard-delete unless retention law applies |
| Portability         | CSV / JSON export per patient                  |
| Restriction         | Flag `processing_restricted` on patient record |
| Object              | Opt-out of marketing via template banner       |

## Data Protection Officer

- Email: dpo@clary.uz (external DPO firm for Phase 1; in-house later)
