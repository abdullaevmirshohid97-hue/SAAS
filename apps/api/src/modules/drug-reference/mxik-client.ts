import { Injectable, Logger } from '@nestjs/common';

import {
  fromElastic,
  fromWebKatalog,
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
// =============================================================================

const BASE = (process.env.MXIK_API_BASE ?? 'https://tasnif.soliq.uz/api/cls-api').replace(
  /\/+$/,
  '',
);
const UA = 'Clary/1.0 (+https://clary.uz; dorixona katalogi)';

export class MxikHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GTIN-14 → MXIK qidiruvi uchun ko'rinishlar: EAN-13, UPC-A, EAN-8 (takrorsiz). */
export function gtinSearchTerms(gtin14: string): string[] {
  if (!/^\d{14}$/.test(gtin14)) return [gtin14];
  const out: string[] = [];
  if (gtin14.startsWith('000000')) out.push(gtin14.slice(6));
  if (gtin14.startsWith('0')) out.push(gtin14.slice(1));
  if (gtin14.startsWith('00')) out.push(gtin14.slice(2));
  if (!gtin14.startsWith('0')) out.push(gtin14);
  return [...new Set(out)];
}

@Injectable()
export class MxikClient {
  private readonly log = new Logger('MxikClient');

  private async getJson(
    path: string,
    timeoutMs: number,
    retries = 2,
  ): Promise<Record<string, unknown>> {
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
        return (await res.json()) as Record<string, unknown>;
      } catch (e) {
        if (e instanceof MxikHttpError && e.status !== null && e.status < 500) throw e;
        last = e;
      }
    }
    const msg = last instanceof Error ? last.message : String(last);
    throw new MxikHttpError(`MXIK API javob bermadi: ${msg}`, null);
  }

  /** Sinf (yoki subpozitsiya) bo'yicha bitta sahifa. */
  async classPage(
    target: Pick<MxikHarvestTarget, 'classCode' | 'subPositionCode'>,
    pageNo: number,
    pageSize = 1000,
  ): Promise<{ rows: MxikRawRow[]; total: number }> {
    const qs = new URLSearchParams({
      classCode: target.classCode,
      pageNo: String(pageNo),
      pageSize: String(pageSize),
      lang: 'ru',
    });
    if (target.subPositionCode) qs.set('subPositionCode', target.subPositionCode);
    const j = await this.getJson(`/attribute/web-katalog?${qs.toString()}`, 60_000);
    const data = Array.isArray(j['data']) ? (j['data'] as Array<Record<string, unknown>>) : [];
    return { rows: data.map(fromWebKatalog), total: Number(j['recordTotal']) || 0 };
  }

  /**
   * Shtrix-kod bo'yicha (jonli so'rov). `gtin14` — 14 xonali GTIN. MXIK kodni
   * yozilgan ko'rinishida saqlaydi (EAN-13, UPC-A 12 xona, EAN-8 8 xona) va
   * qidiruv nol bilan to'ldirilgan shaklni topmaydi — shuning uchun ko'rinishlar
   * navbatma-navbat so'raladi, aynan shu kod qaytgan birinchi javob olinadi.
   */
  async searchByGtin(gtin14: string): Promise<MxikRawRow[]> {
    for (const term of gtinSearchTerms(gtin14)) {
      const qs = new URLSearchParams({ search: term, size: '5', page: '0', lang: 'ru' });
      const j = await this.getJson(`/elasticsearch/search?${qs.toString()}`, 6_000, 0);
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
    );
    const data = (j['data'] ?? null) as Record<string, unknown> | null;
    return parsePackages(data?.['packageNames']);
  }

  warn(msg: string) {
    this.log.warn(msg);
  }
}
