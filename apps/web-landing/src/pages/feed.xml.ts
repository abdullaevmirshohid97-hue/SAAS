import type { APIRoute } from 'astro';

import { fetchSiteContent, getString, type SiteEntry } from '../lib/cms';
import { BLOG_POSTS } from '../data/posts';

// =============================================================================
// /feed.xml — RSS 2.0 (blog). Manba: CMS by_kind['post'], bo'lmasa posts.ts.
// AI/qidiruv tizimlari kontentni kuzatib borishi + "Clary = Healthcare ERP"
// kontent signalini tarqatish uchun. Base.astro <head> da rel=alternate bilan
// e'lon qilingan.
// =============================================================================

const SITE = 'https://clary.uz';

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toRfc822(dateStr: string): string {
  const d = dateStr ? new Date(dateStr) : new Date();
  return (Number.isNaN(d.getTime()) ? new Date() : d).toUTCString();
}

interface FeedItem {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  category: string;
}

export const GET: APIRoute = async () => {
  const cms = await fetchSiteContent('uz-Latn');
  const cmsPosts: SiteEntry[] = (cms?.by_kind?.['post'] ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  // CMS postlari + evergreen cornerstone (posts.ts) birlashtiriladi — CMS ustun.
  const cmsItems: FeedItem[] = cmsPosts.map((p) => ({
    slug: (p.data?.slug as string) ?? p.key.replace(/^post\./, ''),
    title: getString(p, 'title', p.key),
    excerpt: getString(p, 'excerpt'),
    date: (p.data?.date as string) ?? '',
    category: (p.data?.category as string) ?? 'Blog',
  }));
  const cmsSlugs = new Set(cmsItems.map((i) => i.slug));
  const evergreenItems: FeedItem[] = BLOG_POSTS.filter((p) => !cmsSlugs.has(p.slug)).map((p) => ({
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    date: p.date,
    category: p.category,
  }));
  const items: FeedItem[] = [...evergreenItems, ...cmsItems];

  const lastBuild = items.length
    ? toRfc822(items.map((i) => i.date).sort().reverse()[0] ?? '')
    : new Date().toUTCString();

  const rssItems = items
    .map((i) => {
      const url = `${SITE}/blog/${i.slug}`;
      return `    <item>
      <title>${xmlEscape(i.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <category>${xmlEscape(i.category)}</category>
      <pubDate>${toRfc822(i.date)}</pubDate>
      <description>${xmlEscape(i.excerpt)}</description>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Clary Blog — Healthcare ERP</title>
    <link>${SITE}/blog</link>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml" />
    <description>Healthcare ERP va klinika boshqaruvi bo'yicha qo'llanmalar, tahlillar va yangiliklar — Clary jamoasidan.</description>
    <language>uz</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
${rssItems}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
};
