# ADR-018: Signup / onboarding wizard

- Status: Accepted

## Decision

7-step funnel from `clary.uz/signup` to an active Demo in `app.clary.uz` in under 3 minutes:

1. **Signup form** (email + password OR Google OAuth) + Turnstile CAPTCHA + ToS checkbox
2. **Email verification** (6-digit OTP or magic link)
3. **Wizard step 1** — clinic name + URL slug + country
4. **Wizard step 2** — region + timezone + default language
5. **Wizard step 3** — organization type (Clinic / Hospital / Diagnostic Center / Dental) — seeds relevant catalog defaults
6. **Wizard step 4** — staff count — plan recommendation
7. **Wizard step 5** — optional branding (logo + primary color)

Then redirect to `/onboarding` in the app with a 10-step in-app checklist (confetti animation per step).

## Consequences

- Trial -> Paid conversion emails on day 7, 11, 13; sales alert at day 13; 3-day grace + 20% rescue discount after expiry
- Each signup event is tracked in PostHog for funnel analysis
- Dropout at each wizard step is measured
