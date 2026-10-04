// =============================================================================
// POS katalogi — brauzer ichidagi tez qidiruv va skaner bo'yicha topish
// =============================================================================
// Katalog bir marta yuklanadi (GET /pharmacy/pos/catalog) va shu yerda
// indekslanadi: har harfga serverga so'rov ketmaydi, skaner kodi bir zumda
// topiladi (< 50 ms, internet sekin bo'lsa ham).
// =============================================================================

import type { PharmacyCatalogItem } from '@clary/api-client';
import {
  barcodeLookupKeys,
  searchNorm,
  searchScore,
  searchTokens,
  type ParsedScan,
} from '@clary/utils';

export interface CatalogIndex {
  items: PharmacyCatalogItem[];
  byId: Map<string, PharmacyCatalogItem>;
  byCode: Map<string, PharmacyCatalogItem>;
  norm: Map<string, string>;
}

export function buildCatalogIndex(items: PharmacyCatalogItem[]): CatalogIndex {
  const byId = new Map<string, PharmacyCatalogItem>();
  const byCode = new Map<string, PharmacyCatalogItem>();
  const norm = new Map<string, string>();
  for (const it of items) {
    byId.set(it.medication_id, it);
    norm.set(
      it.medication_id,
      it.search_text ??
        searchNorm(
          `${it.name} ${it.strength ?? ''} ${it.form ?? ''} ${it.manufacturer ?? ''} ${it.generic_name ?? ''}`,
        ),
    );
    for (const c of it.barcodes ?? []) {
      byCode.set(c, it);
      // EAN-13 ko'rinishi ham (eski yozuvlar)
      const ean = c.replace(/^0(?=\d{13}$)/, '');
      if (ean !== c) byCode.set(ean, it);
    }
    if (it.barcode) {
      const raw = it.barcode.replace(/\s+/g, '').toUpperCase();
      if (!byCode.has(raw)) byCode.set(raw, it);
    }
  }
  return { items, byId, byCode, norm };
}

/** Skanerlangan kod bo'yicha dori. */
export function findByScan(
  index: CatalogIndex,
  scan: ParsedScan | string,
): PharmacyCatalogItem | null {
  const raw = typeof scan === 'string' ? scan : scan.raw;
  for (const k of barcodeLookupKeys(raw)) {
    const hit = index.byCode.get(k);
    if (hit) return hit;
  }
  return null;
}

/**
 * Nom/dozasi/ishlab chiqaruvchi bo'yicha qidiruv (kirill/lotin farqsiz).
 * Qoldig'i bor dorilar yuqorida.
 */
export function searchCatalog(
  index: CatalogIndex,
  query: string,
  limit = 30,
): PharmacyCatalogItem[] {
  const q = query.trim();
  if (!q) return [];
  const direct = /^\d{6,}$/.test(q) ? findByScan(index, q) : null;
  const tokens = searchTokens(q);
  if (tokens.length === 0) return direct ? [direct] : [];
  const scored: Array<{ it: PharmacyCatalogItem; s: number }> = [];
  for (const it of index.items) {
    const s = searchScore(index.norm.get(it.medication_id) ?? '', tokens);
    if (s < 0) continue;
    scored.push({ it, s: s + (it.qty_sellable > 0 ? 50 : 0) });
  }
  scored.sort((a, b) => b.s - a.s || a.it.name.localeCompare(b.it.name));
  const out = scored.slice(0, limit).map((x) => x.it);
  if (direct && !out.includes(direct)) out.unshift(direct);
  return out;
}
