# Clary Event Taxonomy

Single source of truth for analytics events across landing + clinic.
PostHog and Microsoft Clarity. Update **before** you ship a new event.

## Naming convention

- `snake_case`
- Past tense for actions (`demo_spawned`, `signup_completed`)
- Present for state-checks (`pricing_view`, `dashboard_view`)
- Property keys: snake_case, primitives only (string/number/bool)

## Acquisition funnel (landing)

| Event | Trigger | Properties |
|---|---|---|
| `$pageview` | Auto (every route) | `path` |
| `pricing_period_toggled` | Annual/Monthly switch | `period` |
| `roi_cta_clicked` | "Plan bilan boshlash" in ROI calc | `plan`, `monthly_savings` |
| `ai_demo_run` | "Run AI" in /features/ai | `scenario` |
| `demo_spawned` | One-click demo success | `clinic_id` |
| `exit_intent_shown` | Exit-intent popup opened | — |
| `exit_intent_submitted` | Lead form submitted | — |
| `lead_submitted` | Any /leads POST | `source`, `utm_source` |

## Activation funnel (clinic)

| Event | Trigger | Properties |
|---|---|---|
| `signup_started` | /signup form visible | — |
| `signup_completed` | OAuth/email signup success | `provider` |
| `onboarding_step_X_completed` | Wizard step advanced | `step`, `org_type` |
| `onboarding_completed` | Wizard finished | `org_type` |
| `welcome_modal_shown` | Dashboard ?welcome=1 | — |
| `first_staff_added` | First non-owner profile | — |
| `first_service_added` | First service in catalog | — |
| `first_queue_created` | First queue ticket | **Key conversion event** |
| `first_payment_received` | First cashier transaction | `amount_uzs` |

## Engagement (clinic, recurring)

| Event | Trigger |
|---|---|
| `feature_used` | Module action (props: `module`, `action`) |
| `ai_summary_viewed` | Dashboard AI card scrolled into view |
| `support_contacted` | Help/chat opened |

## UTM & attribution

- First-touch UTMs persisted in `clary_first_touch` cookie (180d)
- Last-touch in `clary_last_touch` cookie (30d)
- Both registered as PostHog person properties on identify
- Cross-domain: PostHog `cross_subdomain_cookie: true` if multi-subdomain

## Forbidden

- ❌ PII in event properties (no email, phone, full name, MRN)
- ❌ Free-form text from forms
- ❌ Per-page custom events when `$pageview` already covers it

## Naming review checklist

Before adding a new event:

1. Is there an existing event that already captures this? Reuse first.
2. Is the name verb-noun and past tense?
3. Are the properties bounded (enum) or free-form (avoid)?
4. Will this event still be meaningful in 6 months?
