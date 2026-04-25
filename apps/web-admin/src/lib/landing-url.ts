/**
 * Landing URL resolver.
 *
 * Precedence:
 *   1. VITE_LANDING_URL (explicit env override — dev / staging)
 *   2. In dev (Vite DEV mode) → http://localhost:4321 (default Astro port)
 *   3. In production → https://www.clary.uz
 *
 * Use `landingUrl(path?)` for any anchor tag pointing to the landing site.
 */
export function landingUrl(path: string = '/'): string {
  const base = resolveBase();
  if (!path.startsWith('/')) path = '/' + path;
  return base.replace(/\/$/, '') + path;
}

/**
 * Return an anchor URL for a CMS entry. Each landing section is expected to
 * set `id="entry-<key>"` so Super Admin can "jump to preview".
 */
export function landingPreviewUrl(entryKey: string): string {
  const safe = entryKey.replace(/[^a-zA-Z0-9._-]/g, '-');
  return landingUrl(`/?preview=1#entry-${safe}`);
}

function resolveBase(): string {
  const explicit = import.meta.env.VITE_LANDING_URL as string | undefined;
  if (explicit && explicit.trim()) return explicit.trim();
  if (import.meta.env.DEV) return 'http://localhost:4321';
  return 'https://www.clary.uz';
}
