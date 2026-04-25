# ADR-003: Turborepo monorepo layout

- Status: Accepted

## Decision

Use Turborepo with pnpm workspaces. See [README.md](../../README.md#monorepo-structure) for the full layout.

## Rationale

- Remote caching (Turbo Remote Cache) reduces CI time by 70 percent on cached packages
- Incremental builds — changes to `packages/schemas` rebuild only downstream apps
- pnpm content-addressable store reduces disk usage by ~80 percent versus npm
- Single lockfile — all versions pinned consistently

## Consequences

- All apps share one `node_modules` graph (with pnpm's strict hoisting)
- Version bumps to shared packages (`@clary/schemas`, `@clary/ui-web`) trigger rebuild of consumers
- CI must use `pnpm install --frozen-lockfile`
