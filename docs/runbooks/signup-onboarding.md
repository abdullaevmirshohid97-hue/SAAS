# Signup and onboarding

See [ADR-018](../adr/ADR-018-signup-flow.md) for the flow specification.

## Support escalation

If a new clinic cannot complete signup:

1. Check PostHog funnel — which step did they drop at?
2. Look up their email in `profiles`
3. Check `activity_journal` for error events
4. If stuck in email verification, re-issue via super admin panel
