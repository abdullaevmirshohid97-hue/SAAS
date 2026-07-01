// =============================================================================
// Faza 4 — Brauzer print-agent klienti. Tauri EMAS brauzerda (app.clary.uz
// Chrome'da) ishlaganda, agar foydalanuvchida Clary desktop ilova ishlab tursa,
// u 127.0.0.1:7777 da agent ochadi → chek/A4/label SILENT chiqadi.
//
// Agent yo'q bo'lsa (ko'p hollarda) — bu funksiyalar `false` qaytaradi va
// chaqiruvchi brauzer iframe/dialog fallback'iga tushadi. REGRESS YO'Q.
// =============================================================================

const AGENT_BASE = 'http://127.0.0.1:7777';
const HEALTH_TTL_MS = 30_000;

let healthCache: { at: number; ok: boolean } | null = null;

/** Agent mavjudmi (30s kesh). Tez timeout — sekin bo'lsa fallback'ga o'tadi. */
export async function agentHealthy(): Promise<boolean> {
  const now = Date.now();
  if (healthCache && now - healthCache.at < HEALTH_TTL_MS) return healthCache.ok;
  let ok = false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 600);
    const res = await fetch(`${AGENT_BASE}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    ok = res.ok;
  } catch {
    ok = false;
  }
  healthCache = { at: now, ok };
  return ok;
}

async function post(path: string, payload: unknown): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(`${AGENT_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      healthCache = null; // holat o'zgargan bo'lishi mumkin — keshni tozalash
      return false;
    }
    return true;
  } catch {
    healthCache = null;
    return false;
  }
}

/** Termal chekni agent orqali silent chop etish. printerName bo'sh → agent standart. */
export function agentPrintThermal(
  printerName: string,
  content: unknown,
  paperWidth: string,
): Promise<boolean> {
  return post('/print/thermal', { printerName, content, paperWidth });
}

/** A4/label PDF (base64) ni agent orqali silent chop etish. */
export function agentPrintPdf(printerName: string, pdfBase64: string): Promise<boolean> {
  return post('/print/pdf', { printerName, pdfBase64 });
}
