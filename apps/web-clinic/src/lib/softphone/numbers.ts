// =============================================================================
// Softfon raqamlari — sof funksiyalar (testlanadi): terish va ko'rsatish
// =============================================================================

/**
 * Terilgan raqam → Asterisk kutgan ko'rinish. Ruxsat: ichki (201–899),
 * favqulodda (101–104, 112), O'zbekiston raqami (9 / 998XXXXXXXXX / +998...).
 * Boshqasi (xalqaro, qisqa) — null: dialplan ham baribir rad etadi.
 */
export function normalizeDial(raw: string): string | null {
  const s = String(raw ?? '').trim();
  const plus = s.startsWith('+');
  const d = s.replace(/\D/g, '');
  if (!d) return null;
  if (/^[2-8]\d{2}$/.test(d) || /^10[1-4]$/.test(d) || d === '112') return d;
  if (d.length === 9) return d;
  if (d.length === 12 && d.startsWith('998')) return plus ? `+${d}` : d;
  return null;
}

/** Ko'rsatish uchun: 998901234567 → +998 90 123 45 67 (ichki raqam o'zgarmaydi). */
export function prettyNumber(raw: string | null | undefined): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  const nine = d.length === 12 && d.startsWith('998') ? d.slice(3) : d.length === 9 ? d : null;
  if (!nine) return String(raw ?? '') || '—';
  return `+998 ${nine.slice(0, 2)} ${nine.slice(2, 5)} ${nine.slice(5, 7)} ${nine.slice(7)}`;
}
