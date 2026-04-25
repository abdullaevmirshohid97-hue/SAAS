# ADR-004: Offline conflict resolution

- Status: Accepted

## Context

Uzbek clinics often have intermittent connectivity. Mobile app must keep working and sync later.

## Decision

- Local DB: **WatermelonDB** (SQLite-backed) on mobile
- Writes are stored locally with a client-generated UUID (idempotency key)
- Sync worker flushes queue on reconnect via `POST /sync/batch`
- Conflict resolution: **server-wins** on `updated_at`, with a **conflict UI** for ambiguous clinical data (treatment notes, vitals)
- Clinical notes are **append-only** on the server; no conflict possible
- Optimistic concurrency via a `version INT` column on all mutable tables

## Consequences

- Offline users see immediate feedback (optimistic UI)
- Sync failures are re-attempted with exponential backoff
- Operators can audit all deferred writes in the Activity Journal
