# Service Level Agreement (SLA)

**Applies to:** 120PRO plan.
**Lower tiers:** best-effort, no credits.

## 1. Uptime commitment

- **Target**: 99.9% monthly uptime ("three nines")
- **Measurement**: external synthetic check on `app.clary.uz/_health` every minute (Uptime Kuma / Checkly)
- **Excluded**: scheduled maintenance (announced 72h in advance, max 4h/month), force majeure, Customer's own network

## 2. Service credits

| Monthly uptime | Credit (% of monthly fee) |
|----------------|---------------------------|
| < 99.9%        | 10%                       |
| < 99.0%        | 25%                       |
| < 95.0%        | 50%                       |

Credits must be requested within 30 days via billing@clary.uz.

## 3. Response times for incidents

| Severity | Response | Workaround | Resolution target |
|----------|----------|------------|-------------------|
| S1 (down) | 15 min  | 1 h        | 4 h               |
| S2 (critical feature broken) | 1 h | 4 h | 24 h    |
| S3 (non-critical)  | 1 business day | 3 bus. days | 10 bus. days |

## 4. Status page

<https://status.clary.uz> — real-time and historical.

## 5. Limits

Credits are the sole remedy for SLA breaches. They cannot exceed the monthly fee.
