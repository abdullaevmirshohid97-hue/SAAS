export interface SiteEntry {
  key: string;
  kind: string;
  sort_order: number;
  content: Record<string, unknown>;
  content_i18n: Record<string, Record<string, unknown>>;
  data: Record<string, unknown>;
}

export interface SiteMedia {
  id: string;
  kind: 'image' | 'video' | 'document';
  url: string;
  poster_url: string | null;
  alt_i18n: Record<string, string>;
  tags: string[];
}

export interface SiteContent {
  locale: string;
  entries: SiteEntry[];
  by_kind: Record<string, SiteEntry[]>;
  by_key: Record<string, SiteEntry>;
  media: SiteMedia[];
}

const API_BASE =
  (typeof import.meta !== 'undefined' ? (import.meta as unknown as { env?: Record<string, string> }).env?.PUBLIC_API_URL : undefined) ??
  (typeof process !== 'undefined' ? process.env?.PUBLIC_API_URL : undefined) ??
  'https://api.clary.uz';

export async function fetchSiteContent(locale = 'uz-Latn'): Promise<SiteContent | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/site/content?locale=${encodeURIComponent(locale)}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as SiteContent;
  } catch {
    return null;
  }
}

export function getString(entry: SiteEntry | undefined, field: string, fallback = ''): string {
  if (!entry) return fallback;
  const v = entry.content?.[field];
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

// SEO meta override — admin CMS'dagi `seo` kind, key formati: `seo:<path>`
// (masalan `seo:/`, `seo:/pricing`). Topilsa sahifaning hardcoded title/
// description/og_image qiymatlarini almashtiradi; topilmasa undefined —
// sahifa o'z fallback'ini ishlatadi.
export interface SeoOverride {
  title?: string;
  description?: string;
  ogImage?: string;
}

export function getSeoOverride(cms: SiteContent | null, path: string): SeoOverride | undefined {
  const entry = cms?.by_key?.[`seo:${path}`];
  if (!entry) return undefined;
  const title = getString(entry, 'title');
  const description = getString(entry, 'description');
  const ogImage =
    (typeof entry.data?.og_image === 'string' && entry.data.og_image) ||
    getString(entry, 'og_image') ||
    undefined;
  return {
    title: title || undefined,
    description: description || undefined,
    ogImage,
  };
}

export interface AppVersion {
  app: string;
  channel: string;
  version: string;
  min_supported_version: string;
  force_update: boolean;
  released_at: string;
  release_notes_i18n: Record<string, string>;
  download_url: string | null;
  changelog_url: string | null;
  metadata: Record<string, unknown>;
}

export async function fetchAppVersions(): Promise<AppVersion[]> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/public/app-versions`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { versions?: AppVersion[] };
    return json.versions ?? [];
  } catch {
    return [];
  }
}
