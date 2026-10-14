// =============================================================================
// STT sifati: WER (so'z xatosi) va CER (harf xatosi) — Faza 0 sinovi uchun
// =============================================================================

/** Taqqoslash uchun normallashtirish: kichik harf, apostroflar bir xil, tinish belgisiz. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’ʻʼ`´]/g, "'")
    .replace(/o'/g, 'o‘')
    .replace(/g'/g, 'g‘')
    .replace(/[^\p{L}\p{N}‘\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein<T>(a: T[], b: T[]): number {
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j] ?? 0;
  }
  return prev[b.length] ?? 0;
}

/** WER: (o'rniga + tushib qolgan + ortiqcha) / etalon so'zlar soni. */
export function wer(reference: string, hypothesis: string): number {
  const r = normalizeText(reference).split(' ').filter(Boolean);
  const h = normalizeText(hypothesis).split(' ').filter(Boolean);
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  return levenshtein(r, h) / r.length;
}

/** CER: harf darajasida (bo'shliqsiz) — ism/familiya xatolarini yaxshiroq ko'rsatadi. */
export function cer(reference: string, hypothesis: string): number {
  const r = [...normalizeText(reference).replace(/\s/g, '')];
  const h = [...normalizeText(hypothesis).replace(/\s/g, '')];
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  return levenshtein(r, h) / r.length;
}
