import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { z } from 'zod';

import { SupabaseService } from '../../common/services/supabase.service';
import { unitLabel, type UnitKind } from '@clary/utils';
import { pharmacyWs } from './pharmacy-ctx';
import { FiscalSettingsSchema } from './pharmacy.schemas';
import {
  fiscalProvider,
  vatIncluded,
  type FiscalItem,
  type FiscalPayload,
} from './fiscal-providers';

// =============================================================================
// Fiskal chek — navbat, yuborish, qayta urinish
// =============================================================================
// Sotuv HECH QACHON fiskal xizmat sababli to'xtamaydi: savdo avval bazaga
// yoziladi, keyin fiskal chek navbatga tushadi va 4 soniya ichida javob kelsa
// chekka QR bilan chiqadi; kelmasa — fon rejimida har daqiqada qayta urinadi.
// =============================================================================

export type FiscalSettings = {
  clinic_id: string;
  enabled: boolean;
  provider: 'test' | 'http';
  company_tin: string | null;
  company_name: string | null;
  terminal_id: string | null;
  endpoint_url: string | null;
  secret_vault_id: string | null;
  auto_send: boolean;
  block_without_mxik: boolean;
  default_vat_percent: number;
};

export type FiscalSummary = {
  id: string;
  status: string;
  is_test: boolean;
  fiscal_sign: string | null;
  fiscal_number: string | null;
  terminal_id: string | null;
  qr_url: string | null;
  last_error: string | null;
};

const SUMMARY_COLS =
  'id, status, is_test, fiscal_sign, fiscal_number, terminal_id, qr_url, last_error';

@Injectable()
export class PharmacyFiscalService {
  private readonly log = new Logger('PharmacyFiscal');
  private readonly settingsCache = new Map<string, { at: number; v: FiscalSettings | null }>();
  private running = false;

  constructor(private readonly supabase: SupabaseService) {}

  async getSettings(clinicId: string): Promise<FiscalSettings | null> {
    const hit = this.settingsCache.get(clinicId);
    if (hit && Date.now() - hit.at < 30_000) return hit.v;
    const { data } = await this.supabase
      .admin()
      .from('pharmacy_fiscal_settings')
      .select('*')
      .eq('clinic_id', clinicId)
      .maybeSingle();
    const v = (data as FiscalSettings | null) ?? null;
    this.settingsCache.set(clinicId, { at: Date.now(), v });
    return v;
  }

  /** UI uchun — kalit qaytmaydi, faqat bor/yo'qligi. */
  async publicSettings(clinicId: string) {
    const s = await this.getSettings(clinicId);
    return {
      enabled: s?.enabled ?? false,
      provider: s?.provider ?? 'test',
      company_tin: s?.company_tin ?? null,
      company_name: s?.company_name ?? null,
      terminal_id: s?.terminal_id ?? null,
      endpoint_url: s?.endpoint_url ?? null,
      has_secret: !!s?.secret_vault_id,
      auto_send: s?.auto_send ?? true,
      block_without_mxik: s?.block_without_mxik ?? false,
      default_vat_percent: Number(s?.default_vat_percent ?? 0),
    };
  }

  async saveSettings(
    clinicId: string,
    userId: string,
    input: z.infer<typeof FiscalSettingsSchema>,
  ) {
    const admin = this.supabase.admin();
    const cur = await this.getSettings(clinicId);
    let vaultId = cur?.secret_vault_id ?? null;
    if (input.secret && input.secret.trim()) {
      const { data, error } = await admin.rpc(
        'create_secret' as never,
        { new_secret: input.secret.trim(), new_name: `fiscal-${clinicId}-${Date.now()}` } as never,
      );
      if (error) throw new BadRequestException(`Kalit saqlanmadi: ${error.message}`);
      vaultId = data as unknown as string;
    }
    if (input.enabled && input.provider === 'http' && !input.endpoint_url) {
      throw new BadRequestException('Tashqi fiskal xizmat uchun URL manzil kiriting');
    }
    const { error } = await admin.from('pharmacy_fiscal_settings').upsert(
      {
        clinic_id: clinicId,
        enabled: input.enabled,
        provider: input.provider,
        company_tin: input.company_tin ?? null,
        company_name: input.company_name ?? null,
        terminal_id: input.terminal_id ?? null,
        endpoint_url: input.endpoint_url ?? null,
        secret_vault_id: vaultId,
        auto_send: input.auto_send ?? true,
        block_without_mxik: input.block_without_mxik ?? false,
        default_vat_percent: input.default_vat_percent ?? 0,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'clinic_id' },
    );
    if (error) throw new BadRequestException(error.message);
    this.settingsCache.delete(clinicId);
    return this.publicSettings(clinicId);
  }

  /** Sotuvdan oldin: MXIK'siz sotuv bloklanadimi. */
  async assertMxik(clinicId: string, medicationIds: string[]) {
    const s = await this.getSettings(clinicId);
    if (!s?.enabled || !s.block_without_mxik || medicationIds.length === 0) return;
    const { data } = await this.supabase
      .admin()
      .from('medications')
      .select('name, mxik_code')
      .eq('clinic_id', clinicId)
      .in('id', medicationIds);
    const missing = ((data ?? []) as Array<{ name: string; mxik_code: string | null }>)
      .filter((m) => !m.mxik_code)
      .map((m) => m.name);
    if (missing.length > 0) {
      throw new BadRequestException(
        `Fiskal chek uchun MXIK kod kiritilmagan: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`,
      );
    }
  }

  /**
   * Sotuvdan keyin: fiskal sozlama yoqilgan bo'lsa navbatga qo'shadi va
   * `waitMs` ichida yuborishga urinadi. Yoqilmagan bo'lsa null.
   */
  async enqueueSale(
    clinicId: string,
    saleId: string,
    waitMs = 4000,
  ): Promise<FiscalSummary | null> {
    const s = await this.getSettings(clinicId);
    if (!s?.enabled) return null;
    const payload = await this.buildPayload(clinicId, saleId, 'sale', 'sale', null, s);
    const id = await this.insertReceipt(clinicId, saleId, 'sale', 'sale', payload, s);
    if (!id) return this.summaryFor(saleId, 'sale');
    if (s.auto_send) await this.sendWithTimeout(id, waitMs);
    return this.summaryById(id);
  }

  /**
   * Qaytarish/bekor qilish: asl sotuv fiskallashtirilgan bo'lsa qaytarish cheki.
   * `items` — qaytarilgan qatorlar (sale_item_id → base qty); null = butun sotuv.
   */
  async enqueueRefund(
    clinicId: string,
    saleId: string,
    refKey: string,
    items: Array<{ sale_item_id: string; qty: number }> | null,
  ): Promise<FiscalSummary | null> {
    const s = await this.getSettings(clinicId);
    if (!s?.enabled) return null;
    const { data: orig } = await this.supabase
      .admin()
      .from('fiscal_receipts')
      .select('id, status')
      .eq('sale_id', saleId)
      .eq('ref_key', 'sale')
      .maybeSingle();
    if (!orig || (orig as { status: string }).status !== 'sent') return null;
    const payload = await this.buildPayload(clinicId, saleId, 'refund', refKey, items, s);
    const id = await this.insertReceipt(clinicId, saleId, 'refund', refKey, payload, s);
    if (!id) return null;
    if (s.auto_send) await this.sendWithTimeout(id, 3000);
    return this.summaryById(id);
  }

  async list(clinicId: string, status?: string) {
    let q = this.supabase
      .admin()
      .from('fiscal_receipts')
      .select(
        'id, sale_id, kind, ref_key, status, provider, is_test, fiscal_sign, fiscal_number, terminal_id, qr_url, total_uzs, attempts, last_error, created_at, sent_at',
      )
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async retry(clinicId: string, id: string) {
    const { data } = await this.supabase
      .admin()
      .from('fiscal_receipts')
      .select('id, status')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .maybeSingle();
    if (!data) throw new NotFoundException('Fiskal chek topilmadi');
    if ((data as { status: string }).status === 'sent') return this.summaryById(id);
    await this.send(id);
    return this.summaryById(id);
  }

  async summaryForSale(saleId: string): Promise<FiscalSummary | null> {
    return this.summaryFor(saleId, 'sale');
  }

  // ---------------------------------------------------------------------------

  @Cron(CronExpression.EVERY_MINUTE)
  async retryPending() {
    if (this.running) return;
    this.running = true;
    try {
      const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
      const { data } = await this.supabase
        .admin()
        .from('fiscal_receipts')
        .select('id, attempts, created_at')
        .in('status', ['pending', 'failed'])
        .lt('attempts', 8)
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .limit(20);
      for (const r of (data ?? []) as Array<{ id: string; attempts: number; created_at: string }>) {
        // Eksponensial kutish (yaratilgandan beri): 1, 2, 4, 8 ... 128 daqiqa —
        // fiskal xizmat bir necha soat ishlamasa ham cheklar yo'qolmaydi.
        const waitMin = Math.pow(2, r.attempts);
        if (Date.now() - new Date(r.created_at).getTime() < waitMin * 60_000) continue;
        await this.send(r.id).catch(() => undefined);
      }
    } catch (e) {
      this.log.warn(`fiskal navbat: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async sendWithTimeout(id: string, ms: number) {
    await Promise.race([
      this.send(id).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, ms)),
    ]);
  }

  private async send(id: string): Promise<void> {
    const admin = this.supabase.admin();
    const { data: row } = await admin
      .from('fiscal_receipts')
      .select('id, clinic_id, sale_id, kind, status, attempts, payload')
      .eq('id', id)
      .maybeSingle();
    const r = row as {
      id: string;
      clinic_id: string;
      sale_id: string;
      kind: string;
      status: string;
      attempts: number;
      payload: FiscalPayload;
    } | null;
    if (!r || r.status === 'sent') return;
    const s = await this.getSettings(r.clinic_id);
    if (!s?.enabled) {
      await admin.from('fiscal_receipts').update({ status: 'skipped' }).eq('id', id);
      return;
    }
    const provider = fiscalProvider(s.provider);
    let secret: string | null = null;
    if (s.provider === 'http' && s.secret_vault_id) {
      const { data: dec } = await admin
        .schema('vault' as never)
        .from('decrypted_secrets' as never)
        .select('decrypted_secret')
        .eq('id', s.secret_vault_id)
        .maybeSingle();
      secret = (dec as { decrypted_secret: string | null } | null)?.decrypted_secret ?? null;
    }
    try {
      const res = await provider.send(r.payload, {
        endpoint_url: s.endpoint_url,
        secret,
        terminal_id: s.terminal_id,
      });
      await admin
        .from('fiscal_receipts')
        .update({
          status: 'sent',
          provider: provider.id,
          is_test: res.is_test,
          fiscal_sign: res.fiscal_sign,
          fiscal_number: res.fiscal_number,
          terminal_id: res.terminal_id,
          qr_url: res.qr_url,
          response: (res.raw ?? null) as never,
          attempts: r.attempts + 1,
          last_error: null,
          sent_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (r.kind === 'sale') {
        await admin
          .from('pharmacy_sales')
          .update({ fiscal_status: res.is_test ? 'test' : 'sent' })
          .eq('id', r.sale_id);
      }
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 500) ?? 'xato';
      await admin
        .from('fiscal_receipts')
        .update({
          status: 'failed',
          provider: provider.id,
          attempts: r.attempts + 1,
          last_error: msg,
        })
        .eq('id', id);
      if (r.kind === 'sale') {
        await admin.from('pharmacy_sales').update({ fiscal_status: 'failed' }).eq('id', r.sale_id);
      }
      this.log.warn(`fiskal chek ${id} yuborilmadi: ${msg}`);
    }
  }

  private async insertReceipt(
    clinicId: string,
    saleId: string,
    kind: 'sale' | 'refund',
    refKey: string,
    payload: FiscalPayload,
    s: FiscalSettings,
  ): Promise<string | null> {
    const { data, error } = await this.supabase
      .admin()
      .from('fiscal_receipts')
      .insert({
        clinic_id: clinicId,
        sale_id: saleId,
        kind,
        ref_key: refKey,
        status: 'pending',
        provider: s.provider,
        is_test: s.provider === 'test',
        payload: payload as never,
        total_uzs: payload.total_uzs,
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') return null; // allaqachon navbatda
      throw new BadRequestException(error.message);
    }
    if (kind === 'sale') {
      await this.supabase
        .admin()
        .from('pharmacy_sales')
        .update({ fiscal_status: 'pending' })
        .eq('id', saleId);
    }
    return (data as { id: string }).id;
  }

  private async summaryById(id: string): Promise<FiscalSummary | null> {
    const { data } = await this.supabase
      .admin()
      .from('fiscal_receipts')
      .select(SUMMARY_COLS)
      .eq('id', id)
      .maybeSingle();
    return (data as FiscalSummary | null) ?? null;
  }

  private async summaryFor(saleId: string, refKey: string): Promise<FiscalSummary | null> {
    const { data } = await this.supabase
      .admin()
      .from('fiscal_receipts')
      .select(SUMMARY_COLS)
      .eq('sale_id', saleId)
      .eq('ref_key', refKey)
      .maybeSingle();
    return (data as FiscalSummary | null) ?? null;
  }

  /** Sotuvdan fiskal so'rov tanasini yig'adi (qadoq/dona bo'yicha guruhlab). */
  private async buildPayload(
    clinicId: string,
    saleId: string,
    kind: 'sale' | 'refund',
    refKey: string,
    refundItems: Array<{ sale_item_id: string; qty: number }> | null,
    s: FiscalSettings,
  ): Promise<FiscalPayload> {
    const admin = this.supabase.admin();
    const [{ data: sale }, { data: items }, { data: pays }] = await Promise.all([
      admin
        .from('pharmacy_sales')
        .select('id, created_at, total_uzs, paid_uzs, received_cash_uzs, change_uzs, operator_id')
        .eq('clinic_id', clinicId)
        .eq('id', saleId)
        .single(),
      admin
        .from('pharmacy_sale_items')
        .select(
          'id, medication_id, name_snapshot, quantity, subtotal_uzs, unit_kind, unit_factor, unit_price_uzs, price_snapshot',
        )
        .eq('clinic_id', clinicId)
        .eq('sale_id', saleId),
      admin.from('pharmacy_sale_payments').select('method, amount_uzs').eq('sale_id', saleId),
    ]);
    if (!sale) throw new NotFoundException('Savdo topilmadi');
    const rows = (items ?? []) as Array<{
      id: string;
      medication_id: string;
      name_snapshot: string;
      quantity: number;
      subtotal_uzs: number;
      unit_kind: string | null;
      unit_factor: number | null;
      unit_price_uzs: number | null;
      price_snapshot: number;
    }>;
    const medIds = [...new Set(rows.map((r) => r.medication_id))];
    const { data: meds } = await admin
      .from('medications')
      .select('id, mxik_code, package_code, vat_percent, unit_name')
      .in('id', medIds.length ? medIds : ['00000000-0000-0000-0000-000000000000']);
    const medMap = new Map(
      (
        (meds ?? []) as Array<{
          id: string;
          mxik_code: string | null;
          package_code: string | null;
          vat_percent: number | null;
          unit_name: string | null;
        }>
      ).map((m) => [m.id, m]),
    );
    const refundMap = refundItems ? new Map(refundItems.map((i) => [i.sale_item_id, i.qty])) : null;

    // Bir dori+birlik bo'yicha guruhlash (FEFO bir qatorni bir necha partiyaga bo'lgan bo'lishi mumkin)
    const groups = new Map<string, FiscalItem & { _base: number; _factor: number }>();
    for (const r of rows) {
      const baseQty = refundMap ? (refundMap.get(r.id) ?? 0) : r.quantity;
      if (baseQty <= 0) continue;
      const amount = refundMap
        ? Math.round((r.subtotal_uzs / Math.max(1, r.quantity)) * baseQty)
        : r.subtotal_uzs;
      const kindU = (r.unit_kind ?? 'unit') as UnitKind;
      const factor = Math.max(1, r.unit_factor ?? 1);
      const med = medMap.get(r.medication_id);
      const key = `${r.medication_id}:${kindU}`;
      const vatPct = Number(med?.vat_percent ?? s.default_vat_percent ?? 0);
      const g = groups.get(key) ?? {
        name: r.name_snapshot,
        mxik_code: med?.mxik_code ?? null,
        package_code: med?.package_code ?? null,
        qty: 0,
        unit: unitLabel(kindU, { unit_name: med?.unit_name ?? null }),
        unit_price_uzs: r.unit_price_uzs ?? r.price_snapshot * factor,
        total_uzs: 0,
        vat_percent: vatPct,
        vat_uzs: 0,
        _base: 0,
        _factor: factor,
      };
      g._base += baseQty;
      g.total_uzs += amount;
      groups.set(key, g);
    }
    const fiscalItems: FiscalItem[] = [...groups.values()].map((g) => {
      const qty = Math.round((g._base / g._factor) * 1000) / 1000;
      return {
        name: g.name,
        mxik_code: g.mxik_code,
        package_code: g.package_code,
        qty,
        unit: g.unit,
        unit_price_uzs: g.unit_price_uzs,
        total_uzs: g.total_uzs,
        vat_percent: g.vat_percent,
        vat_uzs: vatIncluded(g.total_uzs, g.vat_percent),
      };
    });
    const total = fiscalItems.reduce((a, i) => a + i.total_uzs, 0);
    const legs = (pays ?? []) as Array<{ method: string; amount_uzs: number }>;
    let cash = legs
      .filter((l) => l.method === 'cash')
      .reduce((a, l) => a + Number(l.amount_uzs), 0);
    let card = legs
      .filter((l) => ['card', 'humo', 'uzcard'].includes(l.method))
      .reduce((a, l) => a + Number(l.amount_uzs), 0);
    let other = legs
      .filter((l) => !['cash', 'card', 'humo', 'uzcard'].includes(l.method))
      .reduce((a, l) => a + Number(l.amount_uzs), 0);
    if (kind === 'refund') {
      // Qaytarishda pul avval naqd ulushidan qaytariladi
      const c = Math.min(cash, total);
      const k = Math.min(card, total - c);
      cash = c;
      card = k;
      other = Math.max(0, total - c - k);
    }
    const ss = sale as {
      id: string;
      created_at: string;
      received_cash_uzs: number | null;
      change_uzs: number | null;
    };
    return {
      kind,
      sale_id: saleId,
      ref_key: refKey,
      created_at: kind === 'sale' ? ss.created_at : new Date().toISOString(),
      company_tin: s.company_tin,
      company_name: s.company_name,
      terminal_id: s.terminal_id,
      operator: pharmacyWs()?.operatorName ?? null,
      items: fiscalItems,
      total_uzs: total,
      payments: { cash_uzs: cash, card_uzs: card, other_uzs: other },
      received_cash_uzs: kind === 'sale' ? ss.received_cash_uzs : null,
      change_uzs: kind === 'sale' ? ss.change_uzs : null,
    };
  }
}
