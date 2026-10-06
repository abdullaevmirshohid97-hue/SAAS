import { Injectable, Logger } from '@nestjs/common';

import {
  MXIK_API_BASE,
  fromElastic,
  fromWebKatalog,
  gtinSearchTerms,
  mxikClassPageUrl,
  parseGtins,
  parsePackages,
  type MxikHarvestTarget,
  type MxikPackage,
  type MxikRawRow,
} from '@clary/utils';

// =============================================================================
// tasnif.soliq.uz (MXIK) — ochiq API mijozi
// =============================================================================
// Faqat o'qish. Har so'rovda vaqt chegarasi, tarmoq/5xx xatosida 2 marta qayta
// urinish. Sinxronlash ketma-ket (parallel emas) — davlat serverini yuklamaslik.
//
// Server MXIK'ga ulana olmasa (masalan, xorijiy IP bloklangan): tezkor yo'llar
// (skaner jonli so'rovi, qadoq kodlari) 10 daqiqa umuman urinmaydi — prixod
// kutib qolmasin. Katalogni esa super admin brauzer orqali yuklaydi.
// =============================================================================

const BASE = (process.env.MXIK_API_BASE ?? MXIK_API_BASE).replace(/\/+$/, '');
const UA = 'Clary/1.0 (+https://clary.uz; dorixona katalogi)';
const BREAKER_MS = 10 * 60_000;

export class MxikHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "fetch failed" ortidagi haqiqiy sabab (ECONNREFUSED, ENOTFOUND, timeout, TLS…). */
export function describeFetchError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'vaqt tugadi (javob kelmadi)';
  const cause = (e as Error & { cause?: unknown }).cause as
    | (Error & { code?: string; errors?: Array<Error & { code?: string }> })
    | undefined;
  const parts = [e.message];
  if (cause) {
    const code = cause.code ?? cause.errors?.[0]?.code;
    parts.push(code ? `${code}${cause.message ? ` — ${cause.message}` : ''}` : cause.message);
  }
  return parts.filter(Boolean).join(': ');
}

@Injectable()
export class MxikClient {
  private readonly log = new Logger('MxikClient');
  /** Tarmoq xatosidan keyin shu vaqtgacha tezkor so'rovlar yuborilmaydi. */
  private downUntil = 0;
  private lastError: string | null = null;

  /** MXIK serverdan ochiqmi (oxirgi tarmoq xatosidan 10 daqiqa o'tganmi). */
  isAvailable(): boolean {
    return Date.now() >= this.downUntil;
  }

  status() {
    return {
      available: this.isAvailable(),
      last_error: this.lastError,
      retry_at: this.downUntil > Date.now() ? new Date(this.downUntil).toISOString() : null,
    };
  }

  private async getJson(
    path: string,
    timeoutMs: number,
    retries = 2,
    opts: { fast?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    if (opts.fast && !this.isAvailable()) {
      throw new MxikHttpError(
        `MXIK API serverdan yopiq: ${this.lastError ?? 'tarmoq xatosi'}`,
        null,
      );
    }
    let last: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(attempt * 1500);
      try {
        const res = await fetch(`${BASE}${path}`, {
          headers: { 'User-Agent': UA, Accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status >= 500) {
          last = new MxikHttpError(`MXIK API ${res.status}`, res.status);
          continue;
        }
        if (!res.ok) throw new MxikHttpError(`MXIK API ${res.status}`, res.status);
        const json = (await res.json()) as Record<string, unknown>;
        this.downUntil = 0;
        this.lastError = null;
        return json;
      } catch (e) {
        if (e instanceof MxikHttpError && e.status !== null && e.status < 500) throw e;
        last = e;
      }
    }
    const msg = last instanceof MxikHttpError ? last.message : describeFetchError(last);
    if (!(last instanceof MxikHttpError)) {
      // Tarmoq darajasidagi xato — server MXIK'ga umuman yetmayapti
      this.downUntil = Date.now() + BREAKER_MS;
      this.lastError = msg;
    }
    throw new MxikHttpError(`MXIK API javob bermadi: ${msg}`, null);
  }

  /** Sinf (yoki subpozitsiya) bo'yicha bitta sahifa. */
  async classPage(
    target: Pick<MxikHarvestTarget, 'classCode' | 'subPositionCode'>,
    pageNo: number,
    pageSize = 1000,
  ): Promise<{ rows: MxikRawRow[]; total: number }> {
    const url = mxikClassPageUrl(target, pageNo, pageSize, BASE);
    const j = await this.getJson(url.slice(BASE.length), 60_000);
    const data = Array.isArray(j['data']) ? (j['data'] as Array<Record<string, unknown>>) : [];
    return { rows: data.map(fromWebKatalog), total: Number(j['recordTotal']) || 0 };
  }

  /**
   * Shtrix-kod bo'yicha (jonli so'rov). `gtin14` — 14 xonali GTIN. Ko'rinishlar
   * (EAN-13, UPC-A, EAN-8) navbatma-navbat so'raladi, aynan shu kod qaytgan
   * birinchi javob olinadi.
   */
  async searchByGtin(gtin14: string): Promise<MxikRawRow[]> {
    for (const term of gtinSearchTerms(gtin14)) {
      const qs = new URLSearchParams({ search: term, size: '5', page: '0', lang: 'ru' });
      const j = await this.getJson(`/elasticsearch/search?${qs.toString()}`, 6_000, 0, {
        fast: true,
      });
      const data = Array.isArray(j['data']) ? (j['data'] as Array<Record<string, unknown>>) : [];
      const rows = data.map(fromElastic);
      if (rows.some((r) => parseGtins(r.gtin).includes(gtin14))) return rows;
    }
    return [];
  }

  /** Bitta MXIK'ning qadoq kodlari (fiskal chek uchun). */
  async packages(mxikCode: string): Promise<MxikPackage[]> {
    const j = await this.getJson(
      `/integration-mxik/get/history/${encodeURIComponent(mxikCode)}?lang=ru`,
      6_000,
      0,
      { fast: true },
    );
    const data = (j['data'] ?? null) as Record<string, unknown> | null;
    return parsePackages(data?.['packageNames']);
  }
}
