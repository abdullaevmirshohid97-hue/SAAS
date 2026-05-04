import type { APIRoute } from 'astro';

const BASE = 'https://clary.uz';

const STATIC_PATHS = [
  '/',
  '/features',
  '/features/ai',
  '/pricing',
  '/use-cases',
  '/clinics',
  '/patients',
  '/nurses',
  '/about',
  '/contact',
  '/partners',
  '/integrations',
  '/changelog',
  '/blog',
  '/docs',
  '/download',
  '/case-studies',
  '/case-studies/nur-klinika',
  '/demo',
  '/book-demo',
  '/signup',
];

const BLOG_SLUGS = [
  'klinika-boshqaruv-2026',
  'exceldan-clary-7-kun',
  'bemor-tajribasi-10-maslahat',
];

const LOCALES = ['uz-Cyrl', 'ru', 'kk', 'ky', 'tg', 'en'];

export const GET: APIRoute = () => {
  const urls: Array<{ loc: string; priority: number; changefreq: string }> = [];

  for (const path of STATIC_PATHS) {
    const priority = path === '/' ? 1.0 : path === '/pricing' ? 0.9 : 0.7;
    urls.push({ loc: `${BASE}${path}`, priority, changefreq: 'weekly' });
  }
  for (const slug of BLOG_SLUGS) {
    urls.push({ loc: `${BASE}/blog/${slug}`, priority: 0.6, changefreq: 'monthly' });
  }
  for (const loc of LOCALES) {
    urls.push({ loc: `${BASE}/${loc}/`, priority: 0.7, changefreq: 'weekly' });
    urls.push({ loc: `${BASE}/${loc}/pricing`, priority: 0.6, changefreq: 'weekly' });
    urls.push({ loc: `${BASE}/${loc}/blog`, priority: 0.5, changefreq: 'weekly' });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority.toFixed(1)}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
