// =============================================================================
// ROZILIK MATNI RENDERI — sof funksiyalar (testlanadi)
// =============================================================================
// Bu fayldagi mantiq HUQUQIY jihatdan eng nozik joy: chop etilgan qog'ozda
// "{{bemor_fio}}" ko'rinib qolsa yoki qiymat noto'g'ri qo'yilsa, imzolangan
// hujjat yaroqsiz bo'lib qolishi mumkin. Shu sabab alohida modul + testlar.
// =============================================================================

export type ConsentVars = Record<string, string>;

/**
 * `{{kalit}}` → qiymat. Noma'lum kalit BO'SH SATRGA aylanadi — chop etilgan
 * qog'ozda hech qachon xom placeholder qolmasligi kerak.
 * Bo'shliqlarga chidamli: `{{ bemor_fio }}` ham ishlaydi.
 */
export function renderConsentBody(body: string, vars: ConsentVars): string {
  return body.replace(
    /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
    (_m, key: string) => vars[key.toLowerCase()] ?? '',
  );
}

/** Sana — chop etiladigan hujjat uchun (kun.oy.yil). */
export function fmtConsentDate(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Bo'sh bo'laklarni tashlab, vergul bilan birlashtirish (manzil, hujjat). */
export function joinParts(parts: Array<string | null | undefined>, sep = ', '): string {
  return parts.filter((p) => !!p && String(p).trim()).join(sep);
}
