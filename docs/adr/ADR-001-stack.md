# ADR-001: Technology stack

- Status: Accepted
- Date: 2026-04-23

## Context

We are building a greenfield multi-platform clinic management SaaS. The stack must support web (desktop + tablet), mobile (iOS + Android), optional desktop, and a super admin app. End-to-end type safety is non-negotiable.

## Decision

| Layer         | Choice                                                    |
|---------------|-----------------------------------------------------------|
| Monorepo      | Turborepo + pnpm workspaces                               |
| Backend       | NestJS (TypeScript)                                       |
| Database      | PostgreSQL via Supabase Cloud (aoubdvlkcatbeifuysau)      |
| Auth          | Supabase Auth (GoTrue) + custom JWT claims                |
| Web frontend  | React 18 + Vite + TypeScript                              |
| Web routing   | React Router v7 (data APIs)                               |
| Web state     | TanStack Query + Zustand                                  |
| UI (web)      | Tailwind + shadcn/ui + Geist font + framer-motion         |
| Mobile        | Expo SDK 52 + Expo Router + NativeWind                    |
| Landing       | Astro 4 + React islands + MDX                             |
| API contract  | OpenAPI 3.1 generated from Zod (@asteasolutions/zod-to-openapi) |
| Realtime      | Supabase Realtime (Postgres CDC)                          |
| Jobs          | BullMQ + Redis                                            |
| Observability | GlitchTip (Sentry-compatible) + OpenTelemetry + Pino + Grafana + Loki + Prometheus + PostHog |

## Consequences

- Maximum type safety end-to-end (DB -> Zod -> TS -> SDK -> UI)
- Single language (TypeScript) across the entire stack
- Familiar, boring tools — low hiring risk
