import type { APIRoute } from 'astro';

import { fetchSiteContent, type SiteEntry } from '../lib/cms';
import { LOCALES } from '../lib/seo';
import { ALL_SOLUTION_SLUGS, ALL_INDUSTRY_SLUGS, ALL_REGION_SLUGS } from '../data/seo-pages';
import { ALL_COMPARISON_SLUGS } from '../data/comparisons';
import { ALL_BLOG_SLUGS } from '../data/posts';
import { ALL_DOC_SLUGS } from '../data/docs';

// =============================================================================
// sitemap.xml — faqat haqiqatan mavjud, indekslanadigan sahifalar.
// Dinamik marshrutlar (blog, features, use-cases, docs, case-studies) CMS'dan
// olinadi; CMS yetib bo'lmasa — sahifa route'laridagi fallback slug'lar.
// Har lokalizatsiyalangan URL'ga hreflang annotatsiyasi qo'shiladi.
// =============================================================================

const SITE = 'https://clary.uz';

// Statik sahifalar — har biri haqiqatan mavjud .astro fayl.
// Indekslanmaydiganlari (signup, demo, book-demo) bu yerga KIRMAYDI.
const STATIC_PATHS: Array<{ path: string; priority: number; freq: string }> = [
  { path: '/', priority: 1.0, freq: 'weekly' },
  { path: '/features', priority: 0.9, freq: 'weekly' },
  { path: '/features/ai', priority: 0.8, freq: 'monthly' },
  { path: '/pricing', priority: 0.9, freq: 'weekly' },
  { path: '/use-cases', priority: 0.8, freq: 'monthly' },
  { path: '/clinics', priority: 0.7, freq: 'monthly' },
  { path: '/patients', priority: 0.7, freq: 'monthly' },
  { path: '/nurses', priority: 0.7, freq: 'monthly' },
  { path: '/about', priority: 0.6, freq: 'monthly' },
  { path: '/contact', priority: 0.6, freq: 'monthly' },
  { path: '/partners', priority: 0.6, freq: 'monthly' },
  { path: '/integrations', priority: 0.7, freq: 'monthly' },
  { path: '/changelog', priority: 0.5, freq: 'weekly' },
  { path: '/blog', priority: 0.8, freq: 'weekly' },
  { path: '/docs', priority: 0.7, freq: 'weekly' },
  { path: '/download', priority: 0.6, freq: 'monthly' },
  { path: '/case-studies', priority: 0.7, freq: 'monthly' },
  { path: '/launch', priority: 0.5, freq: 'monthly' },
  // Legal
  { path: '/legal/terms', priority: 0.3, freq: 'yearly' },
  { path: '/legal/privacy', priority: 0.3, freq: 'yearly' },
  { path: '/legal/dpa', priority: 0.3, freq: 'yearly' },
  { path: '/legal/cookies', priority: 0.3, freq: 'yearly' },
  { path: '/legal/security', priority: 0.3, freq: 'yearly' },
  { path: '/legal/sla', priority: 0.3, freq: 'yearly' },
  { path: '/legal/acceptable-use', priority: 0.3, freq: 'yearly' },
  { path: '/legal/compliance', priority: 0.3, freq: 'yearly' },
];

// Dinamik marshrut fallback slug'lari — sahifa route'laridagi ro'yxat bilan bir xil.
const FALLBACK = {
  blog: ALL_BLOG_SLUGS, // posts.ts — yagona manba
  features: [
    'reception', 'queue', 'doctor', 'inpatient', 'pharmacy', 'lab',
    'diagnostics', 'cashier', 'analytics', 'marketing', 'staff', 'payroll',
    'dental', 'patient-app', 'self-update', 'rbac', 'audit', 'offline',
    'i18n', 'payments', 'sms',
  ],
  useCases: ['private-clinic', 'dental', 'diagnostic', 'lab', 'home-nurse', 'multi-branch'],
  docs: ALL_DOC_SLUGS, // docs.ts — yagona manba

  caseStudies: ['nur-klinika'],
};

function slugsOf(entries: SiteEntry[] | undefined, prefix: string): string[] {
  if (!entries || entries.length === 0) return [];
  return entries.map((e) => (e.data?.slug as string) ?? e.key.replace(prefix, ''));
}

interface SitemapUrl {
  path: string;
  priority: number;
  freq: string;
}

export const GET: APIRoute = async () => {
  // CMS'dan dinamik slug'lar — yetib bo'lmasa fallback ishlatiladi.
  const cms = await fetchSiteContent('uz-Latn');
  const blog = slugsOf(cms?.by_kind?.['post'], 'post.');
  const features = slugsOf(cms?.by_kind?.['feature_detail'], 'feature_detail.');
  const useCases = slugsOf(cms?.by_kind?.['usecase'], 'usecase.');
  const docs = slugsOf(cms?.by_kind?.['doc'], 'doc.');

  const urls: SitemapUrl[] = [...STATIC_PATHS];
  // CMS blog slug'lari + evergreen cornerstone (posts.ts) birlashtiriladi.
  const blogSlugs = Array.from(new Set([...blog, ...FALLBACK.blog]));
  for (const s of blogSlugs) {
    urls.push({ path: `/blog/${s}`, priority: 0.6, freq: 'monthly' });
  }
  for (const s of features.length ? features : FALLBACK.features) {
    urls.push({ path: `/features/${s}`, priority: 0.7, freq: 'monthly' });
  }
  for (const s of useCases.length ? useCases : FALLBACK.useCases) {
    urls.push({ path: `/use-cases/${s}`, priority: 0.6, freq: 'monthly' });
  }
  const docSlugs = Array.from(new Set([...docs, ...FALLBACK.docs]));
  for (const s of docSlugs) {
    urls.push({ path: `/docs/${s}`, priority: 0.5, freq: 'monthly' });
  }
  for (const s of FALLBACK.caseStudies) {
    urls.push({ path: `/case-studies/${s}`, priority: 0.6, freq: 'monthly' });
  }

  // Programmatic SEO sahifalari — solutions, for, regions (uz + ru).
  urls.push({ path: '/solutions', priority: 0.8, freq: 'monthly' });
  for (const s of ALL_SOLUTION_SLUGS) {
    urls.push({ path: `/solutions/${s}`, priority: 0.8, freq: 'monthly' });
    urls.push({ path: `/ru/solutions/${s}`, priority: 0.7, freq: 'monthly' });
  }
  for (const s of ALL_INDUSTRY_SLUGS) {
    urls.push({ path: `/for/${s}`, priority: 0.7, freq: 'monthly' });
    urls.push({ path: `/ru/for/${s}`, priority: 0.6, freq: 'monthly' });
  }
  for (const s of ALL_REGION_SLUGS) {
    urls.push({ path: `/regions/${s}`, priority: 0.7, freq: 'monthly' });
  }

  // Comparison sahifalari (vs) + jamoa sahifasi
  urls.push({ path: '/vs', priority: 0.7, freq: 'monthly' });
  for (const s of ALL_COMPARISON_SLUGS) {
    urls.push({ path: `/vs/${s}`, priority: 0.7, freq: 'monthly' });
    urls.push({ path: `/ru/vs/${s}`, priority: 0.6, freq: 'monthly' });
  }
  urls.push({ path: '/team', priority: 0.5, freq: 'yearly' });

  // Lokalizatsiyalangan asosiy sahifalar — hreflang annotatsiyasi olinadi.
  const localizedPaths = ['/', '/pricing', '/blog'];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls
  .map((u) => {
    const alternates = localizedPaths.includes(u.path)
      ? '\n' +
        LOCALES.map((l) => {
          const href =
            l.astro === 'uz-Latn'
              ? `${SITE}${u.path}`
              : `${SITE}/${l.astro}${u.path === '/' ? '/' : u.path}`;
          return `    <xhtml:link rel="alternate" hreflang="${l.hreflang}" href="${href}" />`;
        }).join('\n')
      : '';
    return `  <url>
    <loc>${SITE}${u.path}</loc>
    <changefreq>${u.freq}</changefreq>
    <priority>${u.priority.toFixed(1)}</priority>${alternates}
  </url>`;
  })
  .join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
