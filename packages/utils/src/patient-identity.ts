// =============================================================================
// Bemor identifikatsiyasi — "qayta keldi"
// =============================================================================
// Familiya + ism + telefon uchalasi mos kelsa — bu O'SHA bemor (yangi karta
// ochilmaydi, "qayta keldi" deb hisoblanadi). Moslash yozuv farqlariga
// chidamli: kirill/lotin ("Абдуллаев" = "Abdullaev"), katta-kichik harf,
// apostroflar, telefon formati ("+998 77 041-40-20" = "770414020").
// =============================================================================

import { searchNorm } from './search-norm';

export interface PatientIdentity {
  last_name?: string | null;
  first_name?: string | null;
  full_name?: string | null;
  phone?: string | null;
}

/** Telefon kaliti — oxirgi 9 raqam (mamlakat kodisiz). 7 raqamdan kam bo'lsa ''. */
export function phoneKey(phone: string | null | undefined): string {
  const d = (phone ?? '').replace(/\D/g, '');
  if (d.length < 7) return '';
  return d.slice(-9);
}

/**
 * Ism kaliti — kirill/lotin va imlo farqisiz, faqat harflar.
 * Ismlarda rus yozuvi "х" o'zbekcha "h" ham bo'ladi (Миршохид = Mirshohid,
 * Хуршид = Xurshid = Khurshid) — x/х/ҳ/kh bitta harf. Unlilar orasidagi "y"
 * tushadi (Aliyev = Алиев, Abdullayev = Абдуллаев).
 */
export function nameKey(name: string | null | undefined): string {
  const s = (name ?? '')
    .toLowerCase()
    .replace(/[хҳx]/g, 'h')
    .replace(/kh/g, 'h')
    .replace(/([aeiouаеиоуэыёюяў])[yй](?=[aeiouаеиоуэыёюяў])/g, '$1');
  return searchNorm(s).replace(/[^a-z]/g, '');
}

/** Familiya va ism (alohida ustunlar bo'lmasa — to'liq ismdan: "Familiya Ism ..."). */
export function identityNames(p: PatientIdentity): { last: string; first: string } {
  const parts = (p.full_name ?? '').trim().split(/\s+/);
  return {
    last: nameKey(p.last_name || parts[0]),
    first: nameKey(p.first_name || parts[1]),
  };
}

/** Uchala ma'lumot (familiya, ism, telefon) mos keladimi. */
export function samePatientIdentity(a: PatientIdentity, b: PatientIdentity): boolean {
  const pa = phoneKey(a.phone);
  if (!pa || pa !== phoneKey(b.phone)) return false;
  const na = identityNames(a);
  const nb = identityNames(b);
  return !!na.last && !!na.first && na.last === nb.last && na.first === nb.first;
}

/**
 * Bazadan nomzodlarni topish uchun ILIKE naqshi: telefonning oxirgi 7 raqami,
 * orasida istalgan ajratgich ("%0%4%1%4%0%2%0%"). Raqam yetmasa null.
 */
export function phoneIlikePattern(phone: string | null | undefined): string | null {
  const key = phoneKey(phone);
  if (!key) return null;
  return `%${key.slice(-7).split('').join('%')}%`;
}
