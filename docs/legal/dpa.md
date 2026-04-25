# Data Processing Agreement (DPA)

**Version: 1.0**

> DISCLAIMER: Draft pending legal review.

This Data Processing Agreement ("DPA") forms part of the Clary Terms of Service between Clary LLC ("Processor") and Customer ("Controller").

## 1. Subject matter

Processor processes Personal Data, including Patient Data, solely to provide the Services as described in the Order Form.

## 2. Nature and purpose

- Hosting and storing Personal Data
- Enabling Controller's staff to query, update, and export Personal Data
- Sending notifications (SMS/email) via BYO providers on Controller's instructions
- Generating backups

## 3. Processor obligations

Processor shall:

- Process Personal Data only on documented instructions from the Controller
- Ensure personnel are bound by confidentiality
- Implement appropriate technical and organizational measures (see Annex B)
- Not engage sub-processors without prior notice (list in Annex A)
- Assist Controller with data subject requests
- Notify Controller without undue delay (within 72 hours) of any Personal Data breach
- Delete or return Personal Data at the end of the Services

## 4. Controller obligations

- Collect Personal Data lawfully
- Provide necessary notices to data subjects
- Register as a personal-data operator in applicable jurisdictions

## 5. Sub-processors (Annex A)

- Supabase Inc. (hosting)
- Backblaze Inc. (backups)
- Cloudflare Inc. (DNS, CDN, Turnstile)
- Stripe Inc. (platform billing only, not Patient Data)
- Resend Inc. (transactional email, cookieless)
- PostHog Inc. (product analytics, cookieless)

## 6. International transfers

Personal Data may be transferred outside Uzbekistan / EU only under:

- Standard contractual clauses, or
- Binding corporate rules of the sub-processor, or
- Customer's explicit consent

## 7. Audit

Controller may, once per year and with 30 days notice, audit Processor's compliance with this DPA.

## 8. Annex B — Security measures

- Encryption in transit (TLS 1.3+)
- Encryption at rest (AES-256 + pgsodium column-level)
- Access control (RBAC + MFA for admins)
- Logging (activity journal + settings audit log)
- Backups (daily PITR + weekly age-encrypted)
- Incident response (72-hour notification)
