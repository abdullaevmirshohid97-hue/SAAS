# Incident response

## Severity

| Sev | Definition                                         | Response time |
|-----|----------------------------------------------------|----------------|
| S1  | Production down for all tenants                    | 15 minutes     |
| S2  | Cross-tenant data leak suspected                   | 15 minutes     |
| S3  | One tenant cannot use a critical feature           | 1 hour         |
| S4  | Non-critical bug                                   | Next business day |

## Playbook (S1/S2)

1. **Acknowledge** in the on-call channel
2. **Declare** in `#clary-incidents` (even if solo, for the record)
3. **Diagnose** using GlitchTip + Grafana + Loki
4. **Mitigate** (feature flag toggle, circuit breaker, rollback)
5. **Resolve**
6. **Post-mortem** within 5 business days — add an ADR or runbook if the gap warrants it

## On-call rotation

See PagerDuty (or Telegram bot that pages the on-call).
