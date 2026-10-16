import type { SupabaseClient } from '@supabase/supabase-js';

// =============================================================================
// Filial tarmog'i — bemor ko'rinish doirasi.
// Klinika = filial, kompaniya = tarmoq. Tarmoqda bemor bazasi umumiy bo'lsa
// (companies.shared_patients, default true) — filial tarmoqdagi barcha
// filiallarning bemorlarini ko'radi va ular bilan ishlaydi (qabul, kassa,
// shifokor kartasi). Bitta filialda natija = [clinicId] (eski xulq, regress yo'q).
// =============================================================================

type ScopeCacheEntry = { at: number; ids: string[] };
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, ScopeCacheEntry>();

export async function networkPatientScope(
  admin: SupabaseClient,
  clinicId: string,
): Promise<string[]> {
  const hit = cache.get(clinicId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.ids;

  const { data: self } = await admin
    .from('clinics')
    .select('company_id, company:companies(shared_patients)')
    .eq('id', clinicId)
    .maybeSingle();
  const row = self as {
    company_id: string | null;
    company: { shared_patients: boolean | null } | { shared_patients: boolean | null }[] | null;
  } | null;
  const company = Array.isArray(row?.company) ? row?.company[0] : row?.company;
  let ids = [clinicId];
  if (row?.company_id && company?.shared_patients !== false) {
    const { data: branches } = await admin
      .from('clinics')
      .select('id')
      .eq('company_id', row.company_id)
      .is('deleted_at', null);
    const found = ((branches ?? []) as Array<{ id: string }>).map((b) => b.id);
    if (found.length) ids = found.includes(clinicId) ? found : [clinicId, ...found];
  }
  cache.set(clinicId, { at: Date.now(), ids });
  return ids;
}

/** Tarmoq tuzilmasi o'zgarganda (ulash/ajratish) keshni tozalash. */
export function invalidateNetworkScope(clinicIds?: string[]): void {
  if (!clinicIds) {
    cache.clear();
    return;
  }
  for (const id of clinicIds) cache.delete(id);
}
