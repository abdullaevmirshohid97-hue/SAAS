// =============================================================================
// MXIK katalogini BRAUZER orqali yuklash
// =============================================================================
// Server tasnif.soliq.uz'ga ulana olmasa (xorijiy IP bloklanishi mumkin), super
// admin brauzeri sahifalarni to'g'ridan-to'g'ri oladi (MXIK API CORS'ni ochiq
// qo'ygan), @clary/utils bilan serverdagidek o'giradi va API'ga bo'laklab
// yuboradi. Sahifa yopilmasligi kerak (~5 daqiqa).
// =============================================================================

import type { DrugReferenceClassProgress } from '@clary/api-client';
import {
  MXIK_HARVEST_TARGETS,
  fromWebKatalog,
  mapMxikRow,
  mxikClassPageUrl,
  type DrugReferenceRow,
} from '@clary/utils';

import { api } from '@/lib/api';

const PAGE = 1000;
const CHUNK = 1000;
const PAUSE_MS = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(url: string, signal: AbortSignal) {
  let last: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(attempt * 1500);
    if (signal.aborted) throw new DOMException('Bekor qilindi', 'AbortError');
    try {
      const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`MXIK API ${res.status}`);
      return (await res.json()) as { data?: Array<Record<string, unknown>>; recordTotal?: number };
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      last = e;
    }
  }
  throw new Error(`MXIK API javob bermadi: ${(last as Error)?.message ?? last}`);
}

export interface BrowserSyncResult {
  status: 'ok' | 'partial' | 'error';
  upserted: number;
  deactivated: number;
}

export async function syncMxikInBrowser(opts: {
  signal: AbortSignal;
  onProgress: (classes: Record<string, DrugReferenceClassProgress>) => void;
}): Promise<BrowserSyncResult> {
  const session = await api.admin.drugReference.browserSyncStart();
  const classes: Record<string, DrugReferenceClassProgress> = {};
  for (const t of MXIK_HARVEST_TARGETS) {
    classes[t.subPositionCode ?? t.classCode] = {
      label: t.label,
      total: 0,
      fetched: 0,
      mapped: 0,
      upserted: 0,
      complete: false,
      error: null,
    };
  }
  opts.onProgress({ ...classes });

  for (const t of MXIK_HARVEST_TARGETS) {
    const key = t.subPositionCode ?? t.classCode;
    const p = classes[key]!;
    try {
      for (let page = 0; page < 500; page++) {
        const j = await fetchPage(mxikClassPageUrl(t, page, PAGE), opts.signal);
        const raw = Array.isArray(j.data) ? j.data : [];
        if (page === 0) p.total = Number(j.recordTotal) || 0;
        if (raw.length === 0) break;
        p.fetched += raw.length;
        const rows = raw
          .map(fromWebKatalog)
          .filter((r) => !t.subPositionCode || r.mxikCode.startsWith(t.subPositionCode))
          .map((r) => mapMxikRow(r, t.kind))
          .filter((r): r is DrugReferenceRow => !!r);
        p.mapped += rows.length;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const r = await api.admin.drugReference.browserSyncRows({
            sync_id: session.id,
            rows: rows.slice(i, i + CHUNK),
          });
          p.upserted += r.upserted;
        }
        opts.onProgress({ ...classes });
        if (p.fetched >= p.total || raw.length < PAGE) break;
        await sleep(PAUSE_MS);
      }
      p.complete = p.total > 0 && p.fetched >= Math.floor(p.total * 0.98);
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        p.error = 'Bekor qilindi';
        opts.onProgress({ ...classes });
        await api.admin.drugReference
          .browserSyncFinish({ sync_id: session.id, classes })
          .catch(() => null);
        throw e;
      }
      p.error = (e as Error).message;
    }
    opts.onProgress({ ...classes });
  }
  return api.admin.drugReference.browserSyncFinish({ sync_id: session.id, classes });
}
