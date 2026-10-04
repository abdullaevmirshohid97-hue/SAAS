import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

import { SupabaseService } from '../../common/services/supabase.service';
import { pharmacyWs } from './pharmacy-ctx';
import { CashMovementSchema, CloseShiftSchema, OpenShiftSchema } from './pharmacy.schemas';

// =============================================================================
// Dorixona kassasi — har kassaning (Kassa 1, Kassa 2 ...) o'z smenasi
// =============================================================================
// Klinika kassasi (shifts) bilan ARALASHMAYDI: klinikada bir vaqtda faqat
// bitta smena ochiq bo'la oladi, dorixonada esa ikki kassa parallel ishlaydi.
// Alohida dorixona kirishida smena MAJBURIY; klinika ichidagi dorixonada esa
// sozlama bilan yoqiladi (standart — hozirgidek smenasiz).
// =============================================================================

export type ShiftRow = {
  id: string;
  clinic_id: string;
  register_no: number;
  opened_at: string;
  opening_cash_uzs: number;
  closed_at: string | null;
  expected_cash_uzs: number | null;
  actual_cash_uzs: number | null;
  diff_uzs: number | null;
  totals: Record<string, unknown> | null;
  notes: string | null;
  z_no: number | null;
  opened_by_operator: string | null;
  closed_by_operator: string | null;
};

const SHIFT_COLS =
  'id, clinic_id, register_no, opened_at, opening_cash_uzs, closed_at, expected_cash_uzs, ' +
  'actual_cash_uzs, diff_uzs, totals, notes, z_no, opened_by_operator, closed_by_operator';

@Injectable()
export class PharmacyShiftService {
  private readonly kassaFlagCache = new Map<string, { at: number; on: boolean }>();

  constructor(private readonly supabase: SupabaseService) {}

  /** Qaysi kassa: dorixona kirishida operator/qurilma kassasi, aks holda berilgani yoki 1. */
  registerFor(explicit?: number | null): number {
    const ws = pharmacyWs();
    return ws?.registerNo ?? explicit ?? 1;
  }

  /** Smena majburiymi: alohida dorixona kirishida — ha; klinikada — sozlama bo'yicha. */
  async isKassaRequired(clinicId: string): Promise<boolean> {
    if (pharmacyWs()) return true;
    const hit = this.kassaFlagCache.get(clinicId);
    if (hit && Date.now() - hit.at < 30_000) return hit.on;
    const { data } = await this.supabase
      .admin()
      .from('clinics')
      .select('settings')
      .eq('id', clinicId)
      .maybeSingle();
    const settings = ((data as { settings?: Record<string, unknown> } | null)?.settings ??
      {}) as Record<string, unknown>;
    const on = settings['pharmacy_kassa_enabled'] === true;
    this.kassaFlagCache.set(clinicId, { at: Date.now(), on });
    return on;
  }

  async currentShift(clinicId: string, registerNo: number): Promise<ShiftRow | null> {
    const { data, error } = await this.supabase
      .admin()
      .from('pharmacy_shifts')
      .select(SHIFT_COLS)
      .eq('clinic_id', clinicId)
      .eq('register_no', registerNo)
      .is('closed_at', null)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return (data as unknown as ShiftRow | null) ?? null;
  }

  async currentShiftId(clinicId: string, registerNo: number): Promise<string | null> {
    return (await this.currentShift(clinicId, registerNo))?.id ?? null;
  }

  async totals(clinicId: string, shiftId: string): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase
      .admin()
      .rpc('pharmacy_shift_totals' as never, { p_clinic: clinicId, p_shift: shiftId } as never);
    if (error) throw new BadRequestException(error.message);
    return (data as unknown as Record<string, unknown>) ?? {};
  }

  async current(clinicId: string, explicitRegister?: number) {
    const registerNo = this.registerFor(explicitRegister);
    const shift = await this.currentShift(clinicId, registerNo);
    const required = await this.isKassaRequired(clinicId);
    return {
      register_no: registerNo,
      required,
      shift,
      totals: shift ? await this.totals(clinicId, shift.id) : null,
    };
  }

  async open(clinicId: string, userId: string, input: z.infer<typeof OpenShiftSchema>) {
    const ws = pharmacyWs();
    const registerNo = this.registerFor(input.register_no);
    const { data, error } = await this.supabase
      .admin()
      .from('pharmacy_shifts')
      .insert({
        clinic_id: clinicId,
        register_no: registerNo,
        opened_by_user: userId,
        opened_by_operator: ws?.operatorId ?? null,
        device_id: ws?.deviceId ?? null,
        opening_cash_uzs: input.opening_cash_uzs ?? 0,
      })
      .select(SHIFT_COLS)
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new ConflictException(`Kassa ${registerNo} da smena allaqachon ochiq`);
      }
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async close(
    clinicId: string,
    userId: string,
    shiftId: string,
    input: z.infer<typeof CloseShiftSchema>,
  ) {
    const ws = pharmacyWs();
    const shift = await this.getShift(clinicId, shiftId);
    if (ws && ws.operatorRole !== 'admin' && ws.registerNo !== shift.register_no) {
      throw new ForbiddenException('Faqat o‘z kassangiz smenasini yopa olasiz');
    }
    const { data, error } = await this.supabase.admin().rpc(
      'pharmacy_close_shift' as never,
      {
        p_clinic: clinicId,
        p_shift: shiftId,
        p_user: userId,
        p_operator: ws?.operatorId ?? null,
        p_actual_cash: input.actual_cash_uzs,
        p_notes: input.notes ?? null,
      } as never,
    );
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getShift(clinicId: string, shiftId: string): Promise<ShiftRow> {
    const { data } = await this.supabase
      .admin()
      .from('pharmacy_shifts')
      .select(SHIFT_COLS)
      .eq('clinic_id', clinicId)
      .eq('id', shiftId)
      .maybeSingle();
    if (!data) throw new NotFoundException('Smena topilmadi');
    return data as unknown as ShiftRow;
  }

  async list(clinicId: string, params: { from?: string; to?: string; register_no?: number }) {
    const ws = pharmacyWs();
    let q = this.supabase
      .admin()
      .from('pharmacy_shifts')
      .select(SHIFT_COLS)
      .eq('clinic_id', clinicId)
      .order('opened_at', { ascending: false })
      .limit(200);
    if (params.from) q = q.gte('opened_at', params.from);
    if (params.to) q = q.lte('opened_at', params.to);
    // Kassir faqat o'z kassasini ko'radi
    if (ws && ws.operatorRole !== 'admin') q = q.eq('register_no', ws.registerNo ?? 1);
    else if (params.register_no) q = q.eq('register_no', params.register_no);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as unknown as ShiftRow[];
    const opIds = [
      ...new Set(rows.flatMap((r) => [r.opened_by_operator, r.closed_by_operator]).filter(Boolean)),
    ] as string[];
    const names = await this.operatorNames(opIds);
    return rows.map((r) => ({
      ...r,
      opened_by_name: r.opened_by_operator ? (names.get(r.opened_by_operator) ?? null) : null,
      closed_by_name: r.closed_by_operator ? (names.get(r.closed_by_operator) ?? null) : null,
    }));
  }

  async report(clinicId: string, shiftId: string) {
    const shift = await this.getShift(clinicId, shiftId);
    const ws = pharmacyWs();
    if (ws && ws.operatorRole !== 'admin' && ws.registerNo !== shift.register_no) {
      throw new ForbiddenException('Faqat o‘z kassangiz hisobotini ko‘ra olasiz');
    }
    const admin = this.supabase.admin();
    const [totals, { data: moves }, { data: sales }] = await Promise.all([
      shift.closed_at && shift.totals
        ? Promise.resolve(shift.totals)
        : this.totals(clinicId, shiftId),
      admin
        .from('pharmacy_cash_movements')
        .select('id, kind, method, amount_uzs, notes, operator_id, created_at')
        .eq('clinic_id', clinicId)
        .eq('shift_id', shiftId)
        .order('created_at', { ascending: true }),
      admin
        .from('pharmacy_sales')
        .select(
          'id, created_at, total_uzs, paid_uzs, debt_uzs, payment_method, is_void, operator_id',
        )
        .eq('clinic_id', clinicId)
        .eq('pharmacy_shift_id', shiftId)
        .order('created_at', { ascending: true }),
    ]);
    const saleRows = (sales ?? []) as Array<{
      operator_id: string | null;
      total_uzs: number;
      is_void: boolean;
    }>;
    const moveRows = (moves ?? []) as Array<{ operator_id: string | null }>;
    const opIds = [
      ...new Set(
        [
          shift.opened_by_operator,
          shift.closed_by_operator,
          ...saleRows.map((s) => s.operator_id),
          ...moveRows.map((m) => m.operator_id),
        ].filter(Boolean),
      ),
    ] as string[];
    const names = await this.operatorNames(opIds);
    const byOperator = new Map<string, { name: string; count: number; total_uzs: number }>();
    for (const s of saleRows) {
      const key = s.operator_id ?? '—';
      const cur = byOperator.get(key) ?? {
        name: s.operator_id ? (names.get(s.operator_id) ?? '—') : '—',
        count: 0,
        total_uzs: 0,
      };
      cur.count += 1;
      cur.total_uzs += Number(s.total_uzs ?? 0);
      byOperator.set(key, cur);
    }
    return {
      shift: {
        ...shift,
        opened_by_name: shift.opened_by_operator
          ? (names.get(shift.opened_by_operator) ?? null)
          : null,
        closed_by_name: shift.closed_by_operator
          ? (names.get(shift.closed_by_operator) ?? null)
          : null,
      },
      totals,
      movements: (moves ?? []).map((m) => ({
        ...(m as Record<string, unknown>),
        operator_name: (m as { operator_id: string | null }).operator_id
          ? (names.get((m as { operator_id: string }).operator_id) ?? null)
          : null,
      })),
      by_operator: [...byOperator.values()],
      sales_count: saleRows.length,
    };
  }

  /** Qo'lda kassa harakati (rasxod, inkassatsiya, kirim/chiqim). */
  async addMovement(clinicId: string, userId: string, input: z.infer<typeof CashMovementSchema>) {
    const ws = pharmacyWs();
    if (
      ws &&
      ws.operatorRole !== 'admin' &&
      (input.kind === 'encashment' || input.kind === 'cash_out')
    ) {
      throw new ForbiddenException('Inkassatsiya va chiqim faqat admin PIN bilan');
    }
    const registerNo = this.registerFor(input.register_no);
    const shift = await this.currentShift(clinicId, registerNo);
    if (!shift) throw new BadRequestException(`Kassa ${registerNo} da ochiq smena yo'q`);
    const sign = input.kind === 'cash_in' ? 1 : -1;
    return this.recordMovement(clinicId, userId, {
      shiftId: shift.id,
      kind: input.kind,
      amount_uzs: sign * Math.abs(input.amount_uzs),
      method: 'cash',
      notes: input.notes ?? null,
    });
  }

  /** Ichki yordamchi — boshqa servislar ham (qarz undirish, firmaga to'lov) shu orqali yozadi. */
  async recordMovement(
    clinicId: string,
    userId: string,
    m: {
      shiftId: string;
      kind:
        | 'supplier_payment'
        | 'expense'
        | 'encashment'
        | 'debt_collection'
        | 'cash_in'
        | 'cash_out'
        | 'refund';
      amount_uzs: number;
      method: string;
      notes: string | null;
      ref_table?: string;
      ref_id?: string;
    },
  ) {
    const ws = pharmacyWs();
    const { data, error } = await this.supabase
      .admin()
      .from('pharmacy_cash_movements')
      .insert({
        clinic_id: clinicId,
        shift_id: m.shiftId,
        kind: m.kind,
        method: m.method,
        amount_uzs: m.amount_uzs,
        notes: m.notes,
        operator_id: ws?.operatorId ?? null,
        created_by: userId,
        ref_table: m.ref_table ?? null,
        ref_id: m.ref_id ?? null,
      })
      .select('id, kind, method, amount_uzs, notes, created_at')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /** Kassa ochiq bo'lsa harakat yozadi, bo'lmasa jim o'tadi (klinika rejimi). */
  async recordIfOpen(
    clinicId: string,
    userId: string,
    m: Omit<Parameters<PharmacyShiftService['recordMovement']>[2], 'shiftId'> & {
      registerNo?: number | null;
    },
  ) {
    const shiftId = await this.currentShiftId(clinicId, this.registerFor(m.registerNo));
    if (!shiftId) return null;
    return this.recordMovement(clinicId, userId, { ...m, shiftId });
  }

  async listMovements(clinicId: string, shiftId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('pharmacy_cash_movements')
      .select('id, kind, method, amount_uzs, notes, operator_id, created_at')
      .eq('clinic_id', clinicId)
      .eq('shift_id', shiftId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getSettings(clinicId: string) {
    return { kassa_enabled: await this.isKassaRequired(clinicId), workspace: !!pharmacyWs() };
  }

  /** Klinika ichidagi dorixonada smena (kassa) majburiyligini yoqish/o'chirish. */
  async setKassaEnabled(clinicId: string, enabled: boolean) {
    const admin = this.supabase.admin();
    const { data: cur } = await admin
      .from('clinics')
      .select('settings')
      .eq('id', clinicId)
      .maybeSingle();
    const merged = {
      ...(((cur as { settings?: Record<string, unknown> } | null)?.settings ?? {}) as Record<
        string,
        unknown
      >),
      pharmacy_kassa_enabled: enabled,
    };
    const { error } = await admin.from('clinics').update({ settings: merged }).eq('id', clinicId);
    if (error) throw new BadRequestException(error.message);
    this.kassaFlagCache.delete(clinicId);
    return { kassa_enabled: enabled };
  }

  private async operatorNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const { data } = await this.supabase
      .admin()
      .from('pharmacy_operators')
      .select('id, full_name')
      .in('id', ids);
    return new Map(
      ((data ?? []) as Array<{ id: string; full_name: string }>).map((o) => [o.id, o.full_name]),
    );
  }
}
