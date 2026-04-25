# ADR-014: Catalog-driven architecture

- Status: Accepted

## Context

"Klinika admin bir marta parol o'zgartirish uchun ham developer'ga qo'ng'iroq qilmasligi kerak." Clinics must be able to configure every operational parameter (services, prices, rooms, lab tests, medications, discounts, SMS templates, document templates, working hours, roles, ...) without waiting for a developer.

## Decision

- 25+ catalog tables follow a **standard pattern**: `id`, `clinic_id`, domain fields, `is_archived`, `sort_order`, `version`, timestamps, created_by/updated_by
- A **generic NestJS `CatalogModule` factory** exposes CRUD + bulk + history endpoints for every catalog entity with ~20 lines of config
- Settings UI has a **standard catalog page** component that works for all 25+ entities
- Historical transactions store **snapshots** of catalog values (name, price) so price changes don't break history
- Every catalog change is recorded in `settings_audit_log` with a hash chain

## Consequences

- Adding a new catalog entity requires ~1 hour of work (table + module config + UI route)
- No hard-coded pricing / rooms / staff roles anywhere in the codebase
- Matches Salesforce / Odoo level of configurability
