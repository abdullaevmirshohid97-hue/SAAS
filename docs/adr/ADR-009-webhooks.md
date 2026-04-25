# ADR-009: Webhook reliability

- Status: Accepted

## Decision

- Outbound webhooks (when a clinic wants third-party integration) use BullMQ with:
  - 10 retries with exponential backoff (1s -> 2s -> 4s -> ... capped at 1h)
  - HMAC-SHA256 signature (`X-Clary-Signature`)
  - Dead-letter queue after exhaustion; UI shows failed deliveries per endpoint
- Inbound webhooks (from payment providers) are idempotent by provider's reference ID; duplicate IDs are logged but not processed again
- Webhook deliveries are written to `webhook_deliveries` table for audit

## Consequences

- Clinic integrators must verify the signature or reject the payload
- Retries are rate-limited per endpoint (1 RPS max)
