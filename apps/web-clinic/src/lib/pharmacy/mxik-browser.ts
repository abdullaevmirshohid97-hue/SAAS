// =============================================================================
// MXIK (tasnif.soliq.uz) — brauzerdan to'g'ridan-to'g'ri so'rov (zaxira yo'l)
// =============================================================================
// Server MXIK'ga ulana olmasa (xorijiy IP bloklangan bo'lishi mumkin), dorixona
// kompyuteri O'zbekistonda — u API'ga bemalol yetadi (CORS ochiq). Faqat ikki
// joyda ishlatiladi: skanerlangan noma'lum shtrix-kod va qadoq kodlari.
// Xato bo'lsa jim — null (prixod to'xtamaydi).
// =============================================================================

import {
  MXIK_API_BASE,
  fromElastic,
  gtinSearchTerms,
  mapMxikRow,
  parseGtins,
  parsePackages,
  type DrugReferenceRow,
  type MxikPackage,
} from '@clary/utils';

const TIMEOUT_MS = 5000;

async function getJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${MXIK_API_BASE}${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Shtrix-kod (GTIN-14) bo'yicha MXIK yozuvi — aynan shu kod qaytgan birinchisi. */
export async function browserLookupGtin(gtin14: string): Promise<DrugReferenceRow | null> {
  if (!/^\d{14}$/.test(gtin14)) return null;
  for (const term of gtinSearchTerms(gtin14)) {
    const qs = new URLSearchParams({ search: term, size: '5', page: '0', lang: 'ru' });
    const j = await getJson(`/elasticsearch/search?${qs.toString()}`);
    if (!j) return null;
    const data = Array.isArray(j['data']) ? (j['data'] as Array<Record<string, unknown>>) : [];
    for (const raw of data.map(fromElastic)) {
      if (!parseGtins(raw.gtin).includes(gtin14)) continue;
      const row = mapMxikRow(raw);
      if (row) return row;
    }
  }
  return null;
}

/** Bitta MXIK'ning qadoq kodlari (fiskal chek). */
export async function browserPackages(mxikCode: string): Promise<MxikPackage[] | null> {
  if (!/^\d{17}$/.test(mxikCode)) return null;
  const j = await getJson(`/integration-mxik/get/history/${mxikCode}?lang=ru`);
  if (!j) return null;
  const data = (j['data'] ?? null) as Record<string, unknown> | null;
  const list = parsePackages(data?.['packageNames']);
  return list.length ? list : null;
}
