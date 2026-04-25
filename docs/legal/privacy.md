# Privacy Policy

**Effective date: 2026-04-23**
**Version: 1.0**

> DISCLAIMER: Draft pending legal review.

## 1. Who we are

Clary LLC ("Clary") is the controller of personal data you submit via our website and the processor of Patient Data submitted by clinics using our Services.

## 2. Data we collect

### From clinic staff (you use the app)

- Name, email, phone, profile photo, role
- Device identifiers, IP address, browser/OS
- Pages visited, features used (cookieless analytics via PostHog)

### From clinics (controllers)

- Legal entity name, address, tax ID, contact person

### Patient data (Clary acts as processor)

- Identifying information: name, date of birth, national ID number (encrypted)
- Contact: phone, email, address
- Clinical: diagnoses, prescriptions, lab results, diagnostic images
- Billing: payments, insurance

## 3. Why we process

- To provide the Services (contractual necessity)
- To bill (contractual necessity)
- To comply with medical-record retention laws (legal obligation)
- To improve the product (legitimate interest, aggregated and anonymized)

## 4. Where we store

- Primary: Supabase Cloud EU (Ireland)
- Backups: Backblaze B2 (US), age-encrypted
- CDN: Cloudflare (global)

See [data residency](../compliance/data-residency.md) for the migration plan.

## 5. Retention

See [retention policy](../compliance/retention.md).

## 6. Your rights

- Access, rectification, erasure, portability, restriction, objection — contact dpo@clary.uz
- Lodge a complaint with the Uzbek authority (Uzkomhurriyat) or EU supervisory authority

## 7. Security

- 5-layer tenant isolation (RLS + JWT + middleware + audit)
- PII encrypted with pgsodium / pgcrypto
- All traffic TLS 1.3+
- See [security disclosure](security-disclosure.md) for vulnerability reporting

## 8. Children

The Services are not intended for individuals under 18 directly. Pediatric patient records are entered by a parent/guardian's consent through the clinic.

## 9. Contact

- Controller: Clary LLC, Tashkent, Uzbekistan
- DPO: dpo@clary.uz
