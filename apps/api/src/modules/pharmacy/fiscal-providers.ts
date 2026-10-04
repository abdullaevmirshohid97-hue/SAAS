import { createHash } from 'node:crypto';

// =============================================================================
// Fiskal chek provayderlari (adapter)
// =============================================================================
// O'zbekistonda chakana sotuv fiskal chek (onlayn-NKM / virtual kassa) bilan
// rasmiylashtiriladi. Har bir fiskal operator/kassa xizmatining API'si har xil,
// shuning uchun Clary bitta umumiy shakl (FiscalPayload) yuboradi:
//
//   'test' — SINOV rejimi. Hech qayerga yubormaydi, belgisi "TEST-..." bo'ladi va
//            chekda "TEST — fiskal chek emas" deb yoziladi. Sozlash/o'qitish uchun.
//   'http' — tashqi fiskal xizmat (yoki uning oldidagi kichik adapter) URL'iga
//            POST qiladi. So'rov: FiscalPayload (JSON). Kutiladigan javob:
//            { "fiscal_sign": "...", "fiscal_number": "...",
//              "terminal_id": "...", "qr_url": "https://..." }
//            Token Supabase Vault'dan olinib `Authorization: Bearer` bilan yuboriladi.
//
// Yangi provayder qo'shish — shu interfeysni amalga oshirish kifoya.
// =============================================================================

export interface FiscalItem {
  name: string;
  mxik_code: string | null;
  package_code: string | null;
  /** Sotilgan birlik soni (qadoq/blister/dona — `unit` da). */
  qty: number;
  unit: string;
  unit_price_uzs: number;
  total_uzs: number;
  vat_percent: number;
  vat_uzs: number;
}

export interface FiscalPayload {
  kind: 'sale' | 'refund';
  sale_id: string;
  ref_key: string;
  created_at: string;
  company_tin: string | null;
  company_name: string | null;
  terminal_id: string | null;
  operator: string | null;
  items: FiscalItem[];
  total_uzs: number;
  payments: { cash_uzs: number; card_uzs: number; other_uzs: number };
  received_cash_uzs: number | null;
  change_uzs: number | null;
}

export interface FiscalResult {
  fiscal_sign: string;
  fiscal_number: string;
  terminal_id: string | null;
  qr_url: string | null;
  is_test: boolean;
  raw?: unknown;
}

export interface FiscalProviderConfig {
  endpoint_url: string | null;
  secret: string | null;
  terminal_id: string | null;
}

export interface FiscalProvider {
  readonly id: 'test' | 'http';
  send(payload: FiscalPayload, cfg: FiscalProviderConfig): Promise<FiscalResult>;
}

export class TestFiscalProvider implements FiscalProvider {
  readonly id = 'test' as const;

  async send(payload: FiscalPayload, cfg: FiscalProviderConfig): Promise<FiscalResult> {
    const h = createHash('sha256')
      .update(`${payload.sale_id}:${payload.ref_key}:${payload.total_uzs}`)
      .digest('hex')
      .toUpperCase();
    return {
      fiscal_sign: `TEST-${h.slice(0, 12)}`,
      fiscal_number: `TEST-${h.slice(12, 20)}`,
      terminal_id: cfg.terminal_id ?? 'TEST',
      qr_url: null,
      is_test: true,
    };
  }
}

export class HttpFiscalProvider implements FiscalProvider {
  readonly id = 'http' as const;

  async send(payload: FiscalPayload, cfg: FiscalProviderConfig): Promise<FiscalResult> {
    if (!cfg.endpoint_url) throw new Error('Fiskal xizmat URL manzili sozlanmagan');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    try {
      const res = await fetch(cfg.endpoint_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.secret ? { Authorization: `Bearer ${cfg.secret}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        throw new Error(`Fiskal xizmat JSON qaytarmadi (HTTP ${res.status})`);
      }
      if (!res.ok) {
        const msg = (json['error'] ?? json['message'] ?? `HTTP ${res.status}`) as string;
        throw new Error(`Fiskal xizmat rad etdi: ${String(msg).slice(0, 300)}`);
      }
      const sign = json['fiscal_sign'];
      const num = json['fiscal_number'];
      if (typeof sign !== 'string' || !sign || num == null) {
        throw new Error('Fiskal xizmat javobida fiscal_sign / fiscal_number yo‘q');
      }
      return {
        fiscal_sign: sign,
        fiscal_number: String(num),
        terminal_id: (json['terminal_id'] as string | undefined) ?? cfg.terminal_id ?? null,
        qr_url: (json['qr_url'] as string | undefined) ?? null,
        is_test: false,
        raw: json,
      };
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error('Fiskal xizmat javob bermadi (8 s)');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function fiscalProvider(id: string): FiscalProvider {
  return id === 'http' ? new HttpFiscalProvider() : new TestFiscalProvider();
}

/** QQS summasi narx ichida (UZ amaliyoti: narx QQS bilan): total × p / (100 + p). */
export function vatIncluded(total: number, percent: number): number {
  if (!percent || percent <= 0) return 0;
  return Math.round((total * percent) / (100 + percent));
}
