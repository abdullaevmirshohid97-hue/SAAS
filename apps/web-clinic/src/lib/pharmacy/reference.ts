// =============================================================================
// Davlat dori katalogi (MXIK) — dorixona tomonidagi yordamchilar
// =============================================================================
// Katalog serverda (≈50 ming yozuv), shuning uchun qidiruv serverga ketadi —
// lekin har harfga emas: 200 ms pauzadan keyin. 1 harfdan ishlaydi (nom boshi).
// =============================================================================

import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { DrugRefKind, DrugReferenceHit } from '@clary/api-client';

import { api } from '@/lib/api';

export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useReferenceSearch(
  query: string,
  opts: { enabled?: boolean; limit?: number; kind?: DrugRefKind } = {},
) {
  const q = useDebounced(query.trim(), 200);
  const enabled = (opts.enabled ?? true) && q.length >= 1;
  const res = useQuery({
    queryKey: ['pharmacy', 'reference-search', q, opts.limit ?? 30, opts.kind ?? null],
    queryFn: () => api.pharmacy.reference.search(q, { limit: opts.limit ?? 30, kind: opts.kind }),
    enabled,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return {
    hits: enabled ? (res.data ?? []) : [],
    loading: enabled && (res.isFetching || q !== query.trim()),
    error: res.error as Error | null,
  };
}

export const KIND_LABEL: Record<DrugRefKind, string> = {
  drug: 'Dori',
  bad: 'BAD',
  device: 'Tibbiy buyum',
  other: 'Boshqa',
};

/** Ro'yxatdagi ikkinchi qator: shakli · ishlab chiqaruvchi · qadoq. */
export function refSubtitle(h: DrugReferenceHit): string {
  return [
    h.form ?? (h.kind === 'drug' ? h.attribute : null),
    h.manufacturer,
    h.pack_qty > 1 ? `1 qadoq = ${h.pack_qty} ${h.unit_name ?? 'dona'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** EAN-13 ko'rinishi (GTIN-14 "0…" → 13 xona) — formalarda ko'rsatish uchun. */
export function displayBarcode(code: string | null | undefined): string {
  if (!code) return '';
  return /^0\d{13}$/.test(code) ? code.slice(1) : code;
}
