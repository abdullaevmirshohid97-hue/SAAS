# Data retention policies

| Data type                  | Retention                             | After retention         |
|----------------------------|---------------------------------------|-------------------------|
| Patient records            | 30 years (medical record law)         | Anonymize, keep aggregate |
| Clinical notes (append-only)| 30 years                             | Anonymize               |
| Activity journal           | 90 days hot + 2 years archive         | Permanent delete        |
| Settings audit log         | 7 years (append-only)                 | Legal review before deletion |
| Marketing campaign stats   | 2 years                               | Delete                  |
| Backup files               | 30 days weekly B2                     | Delete                  |
| Support chat threads       | 3 years after last message            | Anonymize               |
| Billing invoices           | 10 years (tax law)                    | Anonymize               |

Enforcement: `pg_cron` job runs nightly at 02:00 Asia/Tashkent.
