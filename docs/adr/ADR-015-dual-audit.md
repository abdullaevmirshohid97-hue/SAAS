# ADR-015: Dual audit (Activity Journal + Settings Audit Log)

- Status: Accepted

## Decision

Two independent audit systems:

| Aspect        | Activity Journal                  | Settings Audit Log              |
|---------------|-----------------------------------|---------------------------------|
| Purpose       | Operational feed (who did what)   | Config history (what changed)   |
| Audience      | All clinic staff                  | Admins + super admin only       |
| Real-time     | Yes (Supabase Realtime)           | No (on-demand)                  |
| Retention     | 90d hot + 2y archive              | 7y append-only                  |
| Tamper-evident| No                                | Yes, SHA-256 hash chain         |
| Format        | Event stream (`patient.registered`)| Before/after JSON diff         |
| Revert        | No                                | Yes (super admin)               |

- Hash chain verified hourly by a cron job; any break triggers a Telegram alert
- pgTAP tests verify that UPDATE/DELETE on `settings_audit_log` is blocked at the SQL level

## Consequences

- Operational transparency for all staff (activity feed) without exposing config changes
- Tamper-evident config history is regulator-grade
- Revert creates a NEW audit row (never deletes)
