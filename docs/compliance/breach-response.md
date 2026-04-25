# Breach response procedure

## Detection

- GlitchTip alert for unusual error patterns
- Grafana alert for anomalous query volume
- Hash-chain integrity check failure (hourly cron) -> Telegram S2 alert

## Response (within 72 hours per GDPR)

1. **Contain** — rotate credentials, revoke tokens, block IPs
2. **Assess** — determine scope (affected tenants, data categories)
3. **Notify**
   - Uzkomhurriyat (within 72 hours if >1000 subjects affected)
   - Affected clinics (immediately)
   - Affected individuals (if high risk)
4. **Remediate** — patch, harden, add tests
5. **Post-mortem** — public or private depending on severity
