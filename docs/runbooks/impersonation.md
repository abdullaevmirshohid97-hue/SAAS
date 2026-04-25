# Impersonation runbook

## When

A super admin may impersonate a clinic user only when:

1. The clinic has explicitly requested support via the in-app chat or email
2. The impersonation is logged with a reason

## How

1. Super admin navigates to `admin.clary.uz/tenants/<id>` and clicks "Impersonate"
2. A modal requires:
   - Select the target user
   - Paste the clinic's support ticket ID
   - Write a reason (min 20 chars)
3. A 30-minute short-lived JWT is issued with `impersonated_by: <super_admin_id>`
4. The target clinic sees a bright banner at the top of every page: "You are being viewed by Clary Support (<name>)"
5. Impersonation auto-expires at 30 min; admin can revoke from Super Admin dashboard at any time
6. Every action during the session is logged to `admin_impersonation_sessions` and `activity_journal`

## Abuse prevention

- Rate limit: 5 impersonations per super admin per day
- Quarterly review of all impersonation sessions
- Impersonation is itself a settings audit event (immutable)
