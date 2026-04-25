# ADR-017: Public landing (Astro + MDX + i18n SEO)

- Status: Accepted

## Decision

- Framework: **Astro 4** (zero JS by default) + React islands where interactivity is needed
- Content: MDX files with Astro Content Collections (no CMS for MVP; consider Payload CMS in Phase 9)
- Styling: shared Tailwind preset + shadcn tokens
- i18n: per-language URLs (`/uz`, `/ru`, `/en`, `/kk`, `/ky`, `/tg`, `/uz-kr`)
- SEO: JSON-LD (Organization, SoftwareApplication, Offer, FAQPage), sitemap.xml, robots.txt, llms.txt
- Analytics: PostHog cookieless + Plausible (no cookie banner spam)
- Deploy: VPS (Caddy static)

## Consequences

- Lighthouse 100 target on desktop and 95+ on mobile
- `clary.uz` canonical; `www.clary.uz` 301 redirects
- Blog posts drive organic traffic; 32 posts in first 6 months
