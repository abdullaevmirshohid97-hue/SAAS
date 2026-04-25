# ADR-012: Subscription engine

- Status: Accepted

## Decision

Four plans: **Demo (14 days free), 25PRO ($25/mo), 50PRO ($50/mo), 120PRO ($120/mo)**.

| Plan     | Max staff | Max devices | Custom roles | Advanced analytics |
|----------|-----------|-------------|--------------|---------------------|
| Demo     | 2         | 2           | No           | No                  |
| 25PRO    | 2         | 2           | No           | No                  |
| 50PRO    | 10        | 10          | No           | Yes                 |
| 120PRO   | Unlimited | Unlimited   | Yes          | Yes                 |

- Billing: Stripe Checkout + Customer Portal
- Prorated upgrades; downgrades at end of cycle
- 3-day grace period on failed payment (dunning)
- Trial-to-paid: email at day 7, day 11, day 13; sales alert at day 13

## Consequences

- Clinic can self-serve upgrade/downgrade/cancel at any time
- Overuse of limits (e.g. 3rd staff on 25PRO) is soft-blocked with an upgrade nudge
