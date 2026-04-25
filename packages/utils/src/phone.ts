/**
 * Normalize Uzbek / CIS phone numbers to international format.
 * "+998 90 123 45 67" -> "+998901234567"
 */
export function normalizePhone(raw: string, defaultCountry: 'UZ' | 'KZ' | 'KG' | 'TJ' | 'RU' = 'UZ'): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.startsWith('+')) return '+' + digits;

  // If starts with country code already (998, 7, 996, 992)
  if (/^(998|996|992)/.test(digits) && digits.length >= 11) return '+' + digits;
  if (/^7/.test(digits) && digits.length === 11) return '+' + digits;

  // 9 digits -> prepend Uzbek 998
  const cc: Record<string, string> = { UZ: '998', KZ: '7', KG: '996', TJ: '992', RU: '7' };
  return '+' + cc[defaultCountry] + digits;
}

export function maskPhone(phone: string): string {
  if (phone.length < 6) return phone;
  return phone.slice(0, 4) + '****' + phone.slice(-4);
}

export function isValidUzbekPhone(phone: string): boolean {
  return /^\+998\d{9}$/.test(normalizePhone(phone));
}
