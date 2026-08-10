import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Logger,
  Module,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';
import { CashierService, CashierModule } from '../cashier/cashier.module';

import {
  buildFinanceReportPdf,
  buildReconChecks,
  buildSummaryBlocks,
  buildTotals,
  type FinanceReport,
  type PayrollPerson,
  type ReportLine,
  REPORT_SECTIONS,
  type ReportSection,
} from './finance-report.builder';

// =============================================================================
// MOLIYAVIY HISOBOT QURUVCHI — davr bo'yicha (bank ko'chirmasi standarti)
// =============================================================================
// Nega alohida modul (analytics ichida emas): `analytics` faqat TUSHUMni biladi
// (analytics_query RPC), bu yerda esa to'liq pul manzarasi kerak — rasxot,
// maosh, inkasatsiya, seyf, bank. Ikkalasini aralashtirish "hisobot qaysi
// raqamni ko'rsatyapti?" degan chalkashlikni keltirib chiqaradi.
// =============================================================================

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sana YYYY-MM-DD ko'rinishida bo'lishi kerak");
const REGISTER = z.enum(['reception', 'inpatient']);

const ReportSchema = z.object({
  from: DATE,
  to: DATE,
  register: REGISTER.default('reception'),
  /** Qaysi bo'limlar hisobotga kirsin. Bo'sh/berilmagan = HAMMASI. */
  sections: z.array(z.enum(REPORT_SECTIONS)).optional(),
});

const DrillSchema = z.object({
  from: DATE,
  to: DATE,
  register: REGISTER.default('reception'),
  section: z.enum([
    'revenue',
    'refund',
    'debt',
    'expense',
    'payroll',
    'encashment',
    'adjustment',
    'settlement',
    'settlement_bank',
    'settlement_safe',
    'safe_deposit',
    'safe_out',
    'all',
  ]),
  method_class: z.enum(['cash', 'card', 'transfer', 'other', 'all']).default('all'),
  limit: z.number().int().min(1).max(5000).default(500),
  offset: z.number().int().min(0).default(0),
});

const LedgerSchema = z.object({
  from: DATE,
  to: DATE,
  register: REGISTER.default('reception'),
  /** Qaysi hisob daftari kerak. */
  account: z.enum(['cash', 'safe', 'pending', 'bank', 'all']),
  limit: z.number().int().min(1).max(5000).default(1000),
  offset: z.number().int().min(0).default(0),
});

const CloseSchema = z.object({
  from: DATE,
  to: DATE,
  register: REGISTER.default('reception'),
  /** Kassada QO'LDA sanalgan naqd. Berilsa, farq tuzatuv yozuvi bilan yopiladi. */
  cash_counted_uzs: z.number().int().min(0).nullish(),
  /** Kassadagi naqdni to'liq seyfga o'tkazish (MAGNUS oy yopish tartibi). */
  move_cash_to_safe: z.boolean().default(true),
  /** Bankka o'tmagan naqdsiz pulni ham bankka o'tkazish. */
  settle_noncash: z.boolean().default(false),
  notes: z.string().max(1000).optional(),
  /** Ochiq smena bo'lsa ham davom etish. */
  force: z.boolean().default(false),
});

type Balances = { cash: number; safe: number; pending: number; bank: number; total: number };

const n = (v: unknown) => Number(v ?? 0) || 0;

/** YYYY-MM-DD dan bir kun oldingi sana (boshlang'ich qoldiq uchun). */
function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// -----------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------
@Injectable()
export class FinanceReportService {
  private readonly log = new Logger('FinanceReport');

  constructor(
    private readonly supabase: SupabaseService,
    private readonly cashier: CashierService,
  ) {}

  private async balancesAsof(clinicId: string, asof: string, register: string): Promise<Balances> {
    const { data, error } = await this.supabase.admin().rpc('finance_balances_asof', {
      p_clinic: clinicId,
      p_asof: asof,
      p_register: register,
    });
    if (error) throw new BadRequestException(`Qoldiq hisoblanmadi: ${error.message}`);
    const r = (Array.isArray(data) ? data[0] : data) as Record<string, number> | undefined;
    return {
      cash: n(r?.cash_uzs),
      safe: n(r?.safe_uzs),
      pending: n(r?.pending_uzs),
      bank: n(r?.bank_uzs),
      total: n(r?.total_uzs),
    };
  }

  private async flows(clinicId: string, from: string, to: string, register: string) {
    const { data, error } = await this.supabase.admin().rpc('finance_period_flows', {
      p_clinic: clinicId,
      p_from: from,
      p_to: to,
      p_register: register,
    });
    if (error) throw new BadRequestException(`Aylanma hisoblanmadi: ${error.message}`);
    const r = (Array.isArray(data) ? data[0] : data) as Record<string, number> | undefined;
    const g = (k: string) => n(r?.[k]);
    return {
      rev_cash: g('rev_cash_uzs'),
      rev_cash_count: g('rev_cash_count'),
      rev_card: g('rev_card_uzs'),
      rev_card_count: g('rev_card_count'),
      rev_transfer: g('rev_transfer_uzs'),
      rev_transfer_count: g('rev_transfer_count'),
      rev_other: g('rev_other_uzs'),
      rev_other_count: g('rev_other_count'),
      rev_total: g('rev_total_uzs'),
      rev_count: g('rev_count'),
      ref_cash: g('ref_cash_uzs'),
      ref_cash_count: g('ref_cash_count'),
      ref_card: g('ref_card_uzs'),
      ref_card_count: g('ref_card_count'),
      ref_transfer: g('ref_transfer_uzs'),
      ref_transfer_count: g('ref_transfer_count'),
      ref_other: g('ref_other_uzs'),
      ref_other_count: g('ref_other_count'),
      ref_total: g('ref_total_uzs'),
      ref_count: g('ref_count'),
      debt: g('debt_uzs'),
      debt_count: g('debt_count'),
      exp_cash: g('exp_cash_uzs'),
      exp_safe: g('exp_safe_uzs'),
      exp_noncash: g('exp_noncash_uzs'),
      exp_total: g('exp_total_uzs'),
      exp_count: g('exp_count'),
      pay_cash: g('pay_cash_uzs'),
      pay_safe: g('pay_safe_uzs'),
      pay_noncash: g('pay_noncash_uzs'),
      pay_total: g('pay_total_uzs'),
      pay_count: g('pay_count'),
      encashed: g('encashed_uzs'),
      encash_count: g('encash_count'),
      settled_bank: g('settled_bank_uzs'),
      settled_bank_count: g('settled_bank_count'),
      settled_safe: g('settled_safe_uzs'),
      settled_safe_count: g('settled_safe_count'),
      settle_count: g('settle_count'),
      safe_deposit: g('safe_deposit_uzs'),
      safe_deposit_count: g('safe_deposit_count'),
      safe_out_tx: g('safe_out_tx_uzs'),
      safe_out_count: g('safe_out_count'),
      adj_cash: g('adj_cash_uzs'),
      adj_count: g('adj_count'),
      commission: g('commission_uzs'),
      pharm_revenue: g('pharm_revenue_uzs'),
      pharm_profit: g('pharm_profit_uzs'),
      pharm_debt: g('pharm_debt_uzs'),
      pharm_count: g('pharm_count'),
    };
  }

  /**
   * Maosh — xodim kesimi ("kim qancha oldi"). Faqat maosh bo'limi tanlanganda
   * chaqiriladi: qo'shimcha so'rov bo'lgani uchun bekorga yuklamaymiz.
   */
  private async payrollByPerson(
    clinicId: string,
    from: string,
    to: string,
    register: string,
  ): Promise<PayrollPerson[]> {
    const { data, error } = await this.supabase.admin().rpc('finance_payroll_by_person', {
      p_clinic: clinicId,
      p_from: from,
      p_to: to,
      p_register: register,
    });
    // RPC hali qo'llanmagan bo'lsa hisobot butunlay yiqilmasin — bo'lim
    // shunchaki ko'rinmaydi (qolgan raqamlar to'g'ri qoladi).
    if (error) {
      this.log.warn(`finance_payroll_by_person ishlamadi: ${error.message}`);
      return [];
    }
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      person_id: (r.person_id as string | null) ?? null,
      person_name: String(r.person_name ?? '—'),
      person_role: String(r.person_role ?? '—'),
      payouts_count: n(r.payouts_count),
      net_uzs: n(r.net_uzs),
      cash_uzs: n(r.cash_uzs),
      safe_uzs: n(r.safe_uzs),
      noncash_uzs: n(r.noncash_uzs),
      first_paid_at: (r.first_paid_at as string | null) ?? null,
      last_paid_at: (r.last_paid_at as string | null) ?? null,
    }));
  }

  // ===========================================================================
  // ASOSIY: davr hisoboti
  // ===========================================================================
  async report(clinicId: string, input: z.infer<typeof ReportSchema>): Promise<FinanceReport> {
    const { from, to, register } = input;
    if (from > to)
      throw new BadRequestException("Boshlanish sanasi tugash sanasidan katta bo'lmasin");

    const sections: ReportSection[] =
      input.sections && input.sections.length > 0 ? input.sections : [...REPORT_SECTIONS];

    const admin = this.supabase.admin();
    const [opening, closing, f, clinicRow, closedRow] = await Promise.all([
      this.balancesAsof(clinicId, dayBefore(from), register),
      this.balancesAsof(clinicId, to, register),
      this.flows(clinicId, from, to, register),
      admin.from('clinics').select('name').eq('id', clinicId).maybeSingle(),
      admin
        .from('period_closings')
        .select('id, closed_at, period_from, period_to')
        .eq('clinic_id', clinicId)
        .eq('register', register)
        .eq('status', 'closed')
        .eq('period_from', from)
        .eq('period_to', to)
        .maybeSingle(),
    ]);

    const clinicName = (clinicRow.data as { name?: string } | null)?.name ?? 'Klinika';

    // Maosh — xodim kesimi. Egasi hisobotdan aynan shuni kutadi:
    // "falon shifokor shu davrda qancha oldi". Chuqur izlanishda har to'lov
    // alohida qator edi, ularni odam qo'lda guruhlashi kerak bo'lardi.
    const payrollByPerson = sections.includes('payroll')
      ? await this.payrollByPerson(clinicId, from, to, register)
      : [];

    // --- Hisobot qatorlari (faqat tanlangan bo'limlar) ----------------------
    const lines: ReportLine[] = [];
    const has = (s: ReportSection) => sections.includes(s);

    if (has('cash')) {
      lines.push({
        key: 'rev_cash',
        group: 'income',
        label: 'Naqd savdo (kassaga tushgan)',
        amount_uzs: f.rev_cash,
        count: f.rev_cash_count,
        drill: { section: 'revenue', method_class: 'cash' },
      });
    }
    if (has('card')) {
      lines.push({
        key: 'rev_card',
        group: 'income',
        label: 'Plastik karta savdosi',
        amount_uzs: f.rev_card,
        count: f.rev_card_count,
        drill: { section: 'revenue', method_class: 'card' },
      });
    }
    if (has('transfer')) {
      lines.push({
        key: 'rev_transfer',
        group: 'income',
        label: "O'tkazma (bank) savdosi",
        amount_uzs: f.rev_transfer,
        count: f.rev_transfer_count,
        drill: { section: 'revenue', method_class: 'transfer' },
      });
    }
    if (has('other')) {
      lines.push({
        key: 'rev_other',
        group: 'income',
        label: 'Boshqa naqdsiz (Click / Payme / …)',
        amount_uzs: f.rev_other,
        count: f.rev_other_count,
        drill: { section: 'revenue', method_class: 'other' },
      });
    }
    if (has('refunds')) {
      lines.push({
        key: 'refunds',
        group: 'income',
        label: 'Vozvrat (qaytarilgan pul)',
        amount_uzs: -f.ref_total,
        count: f.ref_count,
        drill: { section: 'refund', method_class: 'all' },
      });
    }
    if (has('debt')) {
      lines.push({
        key: 'debt',
        group: 'info',
        label: 'Qarzga berilgan xizmat (pul kelmagan)',
        amount_uzs: f.debt,
        count: f.debt_count,
        drill: { section: 'debt', method_class: 'all' },
      });
    }
    if (has('expenses')) {
      lines.push({
        key: 'expenses',
        group: 'outflow',
        label: 'Rasxotlar',
        amount_uzs: -f.exp_total,
        count: f.exp_count,
        drill: { section: 'expense', method_class: 'all' },
      });
    }
    if (has('payroll')) {
      lines.push({
        key: 'payroll',
        group: 'outflow',
        label: "Maosh to'lovlari",
        amount_uzs: -f.pay_total,
        count: f.pay_count,
        drill: { section: 'payroll', method_class: 'all' },
      });
    }
    if (has('transfers')) {
      lines.push(
        {
          key: 'encashment',
          group: 'transfer',
          label: 'Inkasatsiya (kassa → seyf)',
          amount_uzs: f.encashed,
          count: f.encash_count,
          drill: { section: 'encashment', method_class: 'all' },
        },
        {
          key: 'settled_bank',
          group: 'transfer',
          label: 'Naqdsiz pul olindi → bank',
          amount_uzs: f.settled_bank,
          count: f.settled_bank_count,
          drill: { section: 'settlement_bank', method_class: 'all' },
        },
        {
          key: 'settled_safe',
          group: 'transfer',
          label: 'Naqdsiz pul olindi → seyf',
          amount_uzs: f.settled_safe,
          count: f.settled_safe_count,
          drill: { section: 'settlement_safe', method_class: 'all' },
        },
        {
          key: 'safe_deposit',
          group: 'transfer',
          label: "Seyfga qo'lda kiritildi",
          amount_uzs: f.safe_deposit,
          count: f.safe_deposit_count,
          drill: { section: 'safe_deposit', method_class: 'all' },
        },
        {
          key: 'safe_out',
          group: 'transfer',
          label: 'Seyfdan chiqim (vozvrat/tuzatish)',
          amount_uzs: -f.safe_out_tx,
          count: f.safe_out_count,
          drill: { section: 'safe_out', method_class: 'all' },
        },
      );
      if (f.adj_cash !== 0 || f.adj_count > 0) {
        lines.push({
          key: 'adjustment',
          group: 'transfer',
          label: 'Naqd tuzatishlar (svertka)',
          amount_uzs: f.adj_cash,
          count: f.adj_count,
          drill: { section: 'adjustment', method_class: 'all' },
        });
      }
    }
    if (has('pharmacy')) {
      lines.push(
        {
          key: 'pharm_revenue',
          group: 'info',
          label: 'Dorixona savdosi',
          amount_uzs: f.pharm_revenue,
          count: f.pharm_count,
          drill: null,
        },
        {
          key: 'pharm_profit',
          group: 'info',
          label: 'Dorixona ustamasi (foyda)',
          amount_uzs: f.pharm_profit,
          count: null,
          drill: null,
        },
      );
    }
    if (has('commission')) {
      lines.push({
        key: 'commission',
        group: 'info',
        label: 'Shifokor komissiyasi (hisoblangan)',
        amount_uzs: f.commission,
        count: null,
        drill: null,
      });
    }

    // --- Yakunlar ------------------------------------------------------------
    const incomeSelected = lines
      .filter((l) => l.group === 'income')
      .reduce((s, l) => s + l.amount_uzs, 0);
    const outflowSelected = lines
      .filter((l) => l.group === 'outflow')
      .reduce((s, l) => s + l.amount_uzs, 0);

    // Tanlovdan QAT'I NAZAR to'liq yakun — "hammasi" tugmasi bosilmagan bo'lsa
    // ham egasi umumiy manzarani ko'rsin (bank ko'chirmasidagi kabi).
    const totals = buildTotals(opening, closing, f, {
      income: incomeSelected,
      outflow: outflowSelected,
    });

    // --- SVERTKA (bank nazorati): boshlang'ich + aylanma = yakuniy ----------
    // Bu hisobotning eng muhim qismi. Mos kelmasa — hisobot ISHONCHSIZ va
    // buni yashirmaymiz: ekranda ham, PDF'da ham qizil bilan ko'rsatiladi.
    const checks = buildReconChecks(opening, closing, f);

    const warnings: string[] = [];
    for (const c of checks) {
      if (!c.ok) {
        warnings.push(
          `⚠ ${c.account}: hisoblangan qoldiq ${c.computed_closing.toLocaleString('uz-UZ')} so'm, ` +
            `haqiqiy ${c.actual_closing.toLocaleString('uz-UZ')} so'm — farq ` +
            `${c.diff.toLocaleString('uz-UZ')} so'm. Hisobotni tasdiqlashdan oldin tekshiring.`,
        );
      }
    }
    // Xodimlar kesimi yig'indisi umumiy maosh summasiga TENG bo'lishi shart —
    // aks holda jadvaldan kimdir tushib qolgan degani.
    if (payrollByPerson.length > 0) {
      const perPersonTotal = payrollByPerson.reduce((s, p) => s + p.net_uzs, 0);
      if (perPersonTotal !== f.pay_total) {
        warnings.push(
          `⚠ Maosh: xodimlar kesimi yig'indisi ${perPersonTotal.toLocaleString('uz-UZ')} so'm, ` +
            `umumiy maosh esa ${f.pay_total.toLocaleString('uz-UZ')} so'm — ` +
            `farq ${(f.pay_total - perPersonTotal).toLocaleString('uz-UZ')} so'm.`,
        );
      }
    }
    // Naqdsiz pul terminalga tushyapti, lekin "olindi" deb hech qachon
    // qayd etilmayapti — qoldiq cheksiz o'sib boradi va bank bilan solishtirib
    // bo'lmaydi. Bu ma'lumot xatosi emas, ISH JARAYONI bo'shlig'i.
    if (
      closing.pending > 0 &&
      f.settled_bank + f.settled_safe === 0 &&
      f.rev_card + f.rev_transfer + f.rev_other > 0
    ) {
      warnings.push(
        `ℹ️ Yo'ldagi pul ${closing.pending.toLocaleString('uz-UZ')} so'm — davr ichida ` +
          "bankka ham, seyfga ham olinmagan. Plastik/o'tkazma pul haqiqatda kelgan bo'lsa, " +
          "Kassa → «Naqdsiz pulni olish» bilan qayd eting; aks holda bu raqam o'sib boraveradi " +
          "va bank ko'chirmasi bilan solishtirib bo'lmaydi.",
      );
    }
    if (f.exp_noncash > 0 && f.settled_bank === 0 && opening.bank <= 0) {
      warnings.push(
        "⚠ Naqdsiz rasxot bor, lekin bankka pul olinmagan — bank qoldig'i manfiy chiqishi mumkin.",
      );
    }

    return {
      period: {
        from,
        to,
        register,
        days: Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1,
      },
      generated_at: new Date().toISOString(),
      clinic: { id: clinicId, name: clinicName },
      sections,
      opening,
      closing,
      lines,
      totals,
      checks,
      warnings,
      closed: closedRow.data
        ? {
            id: (closedRow.data as { id: string }).id,
            closed_at: (closedRow.data as { closed_at: string }).closed_at,
          }
        : null,
      flows: f,
      payroll_by_person: payrollByPerson,
      summary_blocks: buildSummaryBlocks(totals, f),
    };
  }

  // ===========================================================================
  // CHUQUR IZLANISH — raqam ortidagi hujjatlar
  // ===========================================================================
  async drill(clinicId: string, input: z.infer<typeof DrillSchema>) {
    const { data, error } = await this.supabase.admin().rpc('finance_period_rows', {
      p_clinic: clinicId,
      p_from: input.from,
      p_to: input.to,
      p_register: input.register,
      p_section: input.section,
      p_class: input.method_class,
      p_limit: input.limit,
      p_offset: input.offset,
    });
    if (error) throw new BadRequestException(error.message);
    const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      occurred_at: String(r.occurred_at ?? ''),
      doc_type: String(r.doc_type ?? ''),
      doc_id: String(r.doc_id ?? ''),
      party: String(r.party ?? '—'),
      description: String(r.description ?? ''),
      method: String(r.method ?? ''),
      method_class: String(r.method_class ?? ''),
      source: String(r.source ?? ''),
      direction: String(r.direction ?? 'in') as 'in' | 'out',
      amount_uzs: n(r.amount_uzs),
      who: String(r.who ?? '—'),
    }));
    const total = rows.reduce(
      (s, r) => s + (r.direction === 'out' ? -r.amount_uzs : r.amount_uzs),
      0,
    );
    return {
      section: input.section,
      method_class: input.method_class,
      rows,
      count: rows.length,
      sum_uzs: rows.reduce((s, r) => s + r.amount_uzs, 0),
      net_uzs: total,
      /** Qatorlar chegaraga tegdi — jami to'liq emas degan ochiq ogohlantirish. */
      truncated: rows.length >= input.limit,
    };
  }

  // ===========================================================================
  // HISOB DAFTARI — qoldiq kartasi ortidagi barcha harakat
  // ===========================================================================
  async accountLedger(clinicId: string, input: z.infer<typeof LedgerSchema>) {
    const { data, error } = await this.supabase.admin().rpc('finance_account_ledger', {
      p_clinic: clinicId,
      p_from: input.from,
      p_to: input.to,
      p_register: input.register,
      p_account: input.account,
      p_limit: input.limit,
      p_offset: input.offset,
    });
    if (error) throw new BadRequestException(error.message);
    const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      occurred_at: String(r.occurred_at ?? ''),
      account: String(r.account ?? ''),
      doc_type: String(r.doc_type ?? ''),
      doc_id: String(r.doc_id ?? ''),
      party: String(r.party ?? '—'),
      description: String(r.description ?? ''),
      method: String(r.method ?? ''),
      method_class: String(r.method_class ?? ''),
      direction: String(r.direction ?? 'in') as 'in' | 'out',
      amount_uzs: n(r.amount_uzs),
      who: String(r.who ?? '—'),
    }));
    const inflow = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + r.amount_uzs, 0);
    const outflow = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + r.amount_uzs, 0);
    return {
      account: input.account,
      rows,
      count: rows.length,
      inflow_uzs: inflow,
      outflow_uzs: outflow,
      net_uzs: inflow - outflow,
      truncated: rows.length >= input.limit,
    };
  }

  // ===========================================================================
  // PDF
  // ===========================================================================
  async pdf(clinicId: string, input: z.infer<typeof ReportSchema>): Promise<Buffer> {
    const rep = await this.report(clinicId, input);
    return buildFinanceReportPdf(rep);
  }

  // ===========================================================================
  // OY YOPISH
  // ===========================================================================
  // Bank kassiri kun yopish tartibi bilan bir xil ketma-ketlik:
  //   1) davr hisoboti olinadi (snapshot uchun);
  //   2) naqd QO'LDA sanaladi → farq bo'lsa ochiq tuzatuv yozuvi bilan yopiladi;
  //   3) kassadagi naqd seyfga o'tkaziladi (inkasatsiya) — kassa nolga tushadi;
  //   4) (ixtiyoriy) bankka o'tmagan naqdsiz pul bankka olinadi;
  //   5) davr yopiladi va hisobot snapshot'i saqlanadi.
  // Har qadam MAVJUD kassa servisidan o'tadi — ya'ni barcha tekshiruvlar
  // (yetarli mablag', faol smena) o'z-o'zidan qo'llanadi va raqamlar veb bilan
  // hech qachon ajralib ketmaydi.
  async closePeriod(clinicId: string, userId: string, input: z.infer<typeof CloseSchema>) {
    const admin = this.supabase.admin();
    const { from, to, register } = input;
    if (from > to) throw new BadRequestException("Davr sanalari noto'g'ri");

    // 1) Bu davr allaqachon yopilganmi / ustma-ust tushyaptimi?
    const { data: overlaps } = await admin
      .from('period_closings')
      .select('id, period_from, period_to')
      .eq('clinic_id', clinicId)
      .eq('register', register)
      .eq('status', 'closed')
      .lte('period_from', to)
      .gte('period_to', from);
    if ((overlaps ?? []).length > 0) {
      const o = (overlaps as Array<{ period_from: string; period_to: string }>)[0]!;
      throw new BadRequestException(
        `Bu davr allaqachon yopilgan (${o.period_from} – ${o.period_to}). ` +
          "Qayta yopish uchun avval o'sha davrni oching.",
      );
    }

    // 2) Ochiq smena — yopishdan oldin yopilgani ma'qul (kassa raqami qotmaydi).
    const { data: openShifts } = await admin
      .from('shifts')
      .select('id')
      .eq('clinic_id', clinicId)
      .is('closed_at', null);
    const openCount = (openShifts ?? []).length;
    if (openCount > 0 && !input.force) {
      throw new BadRequestException(
        `Ochiq smena bor (${openCount} ta). Avval smenani yoping — aks holda oy yopilgandan ` +
          "keyin ham o'sha smenaga yozuv tushib, hisobot buziladi. " +
          "Baribir davom etish uchun 'majburan yopish' ni tanlang.",
      );
    }

    // 3) Yopishdan OLDINGI hisobot (snapshot uchun asos).
    const before = await this.report(clinicId, { from, to, register, sections: undefined });

    const steps: string[] = [];
    // Davr o'tgan sana bilan yopilsa, inkasatsiya/tuzatish BUGUN yoziladi —
    // ya'ni yopilayotgan davrdan TASHQARIDA. Bu buxgalteriya jihatidan to'g'ri
    // (pul bugun ko'chdi), lekin foydalanuvchi buni bilishi kerak: davr
    // hisobotidagi kassa qoldig'i o'zgarmaydi, jonli kassa esa nolga tushadi.
    const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
    const postedOutsidePeriod = to < todayIso;
    if (postedOutsidePeriod) {
      steps.push(
        `ℹ️ Davr ${to} da tugagan, yopish esa bugun (${todayIso}) — pul harakati bugungi sana ` +
          'bilan yoziladi va yopilgan davr hisobotini o‘zgartirmaydi.',
      );
    }
    let correctionTxId: string | null = null;
    let cashDiff = 0;

    // 4) Kassa svertkasi — qo'lda sanalgan naqd bilan tizim farqi.
    const cohBefore = await this.cashier.cashOnHand(clinicId, register);
    const systemCash = n(cohBefore.cash_on_hand_uzs);
    if (input.cash_counted_uzs != null) {
      cashDiff = input.cash_counted_uzs - systemCash;
      if (cashDiff !== 0) {
        const label = cashDiff > 0 ? 'ortiqcha' : 'kam';
        const { data: adj, error: adjErr } = await admin
          .from('transactions')
          .insert({
            clinic_id: clinicId,
            cashier_id: userId,
            register,
            kind: 'adjustment',
            amount_uzs: cashDiff,
            payment_method: 'cash',
            notes:
              `Kassa tuzatish: oy yopish sanog'i (${from} – ${to}) — ` +
              `tizim ${systemCash}, sanoq ${input.cash_counted_uzs}, ${label} ${Math.abs(cashDiff)}`,
          })
          .select('id')
          .single();
        if (adjErr) throw new BadRequestException(`Kassa tuzatuvi yozilmadi: ${adjErr.message}`);
        correctionTxId = (adj as { id: string }).id;
        steps.push(
          `Kassa svertkasi: ${cashDiff > 0 ? '+' : ''}${cashDiff.toLocaleString('uz-UZ')} so'm tuzatuv yozildi`,
        );
      } else {
        steps.push("Kassa svertkasi: farq yo'q ✓");
      }
    }

    // 5) Kassadagi naqdni seyfga o'tkazish.
    let movedToSafe = 0;
    let encashTxId: string | null = null;
    if (input.move_cash_to_safe) {
      const coh = await this.cashier.cashOnHand(clinicId, register);
      const amount = n(coh.cash_on_hand_uzs);
      if (amount > 0) {
        const enc = await this.cashier.encash(clinicId, userId, {
          amount_uzs: amount,
          destination: 'seyf',
          notes: `Oy yopish ${from} – ${to}`,
          register,
        });
        movedToSafe = amount;
        encashTxId = enc.transaction_id;
        steps.push(
          `Seyfga o'tkazildi: ${amount.toLocaleString('uz-UZ')} so'm — kassa nolga tushdi`,
        );
      } else if (amount < 0) {
        throw new BadRequestException(
          `Kassa qoldig'i manfiy (${amount.toLocaleString('uz-UZ')} so'm). ` +
            "Oy yopishdan oldin sababini aniqlang — bu ma'lumot xatosi.",
        );
      } else {
        steps.push("Kassada naqd yo'q — inkasatsiya qilinmadi");
      }
    }

    // 6) Naqdsiz pulni bankka olish (ixtiyoriy).
    let settled = 0;
    let settleId: string | null = null;
    if (input.settle_noncash) {
      const nb = await this.cashier.noncashBalance(clinicId, register);
      const pending = n(nb.pending_uzs);
      if (pending > 0) {
        const res = await this.cashier.settleToBank(clinicId, userId, {
          amount_uzs: pending,
          destination: 'bank',
          notes: `Oy yopish ${from} – ${to}`,
          register,
        });
        settled = pending;
        settleId = res.id;
        steps.push(`Bankka olindi: ${pending.toLocaleString('uz-UZ')} so'm`);
      } else {
        steps.push("Bankka o'tmagan naqdsiz pul yo'q");
      }
    }

    // 7) Yopishdan KEYINGI hisobot — snapshot aynan shu saqlanadi.
    const after = await this.report(clinicId, { from, to, register, sections: undefined });

    // JONLI holat — kassa kartasi hozir nima ko'rsatishi. Davr o'tgan sana
    // bilan yopilganda `after.closing` (davr oxiridagi qoldiq) o'zgarmaydi,
    // jonli kassa esa nolga tushadi. Foydalanuvchiga aynan shu ko'rsatiladi —
    // aks holda "kassa nolga tushdi" deb yozib, eski raqamni ko'rsatgan bo'lardik.
    const [liveCash, liveSafe] = await Promise.all([
      this.cashier.cashOnHand(clinicId, register),
      this.cashier.safeBalance(clinicId, register),
    ]);
    const live = {
      cash: n(liveCash.cash_on_hand_uzs),
      safe: n((liveSafe as { safe_balance_uzs?: number }).safe_balance_uzs),
    };

    const { data: closing, error: closeErr } = await admin
      .from('period_closings')
      .insert({
        clinic_id: clinicId,
        register,
        period_from: from,
        period_to: to,
        status: 'closed',
        cash_system_uzs: systemCash,
        cash_counted_uzs: input.cash_counted_uzs ?? null,
        cash_diff_uzs: cashDiff,
        moved_to_safe_uzs: movedToSafe,
        encash_tx_id: encashTxId,
        settled_uzs: settled,
        settle_id: settleId,
        snapshot: after as unknown as Record<string, unknown>,
        notes: input.notes ?? null,
        closed_by: userId,
      } as never)
      .select('id, closed_at')
      .single();
    if (closeErr) throw new BadRequestException(`Davr yopilmadi: ${closeErr.message}`);

    // Kalendar oy bo'lsa buxgalteriya davri ham belgilanadi (mavjud
    // `accounting_periods` bilan izchil bo'lishi uchun).
    const isCalendarMonth =
      from.slice(8) === '01' &&
      from.slice(0, 7) === to.slice(0, 7) &&
      Number(to.slice(8)) === new Date(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 0).getDate();
    if (isCalendarMonth) {
      await admin
        .from('accounting_periods')
        .upsert(
          {
            clinic_id: clinicId,
            period_year: Number(from.slice(0, 4)),
            period_month: Number(from.slice(5, 7)),
            status: 'closed',
            revenue_uzs: after.totals.gross_revenue_uzs,
            expense_uzs: after.totals.total_expense_uzs,
            net_profit_uzs: after.totals.operating_net_uzs,
            closed_at: new Date().toISOString(),
            closed_by: userId,
          } as never,
          { onConflict: 'clinic_id,period_year,period_month' },
        )
        .then(
          () => undefined,
          () => undefined,
        );
    }

    return {
      ok: true,
      id: (closing as { id: string }).id,
      closed_at: (closing as { closed_at: string }).closed_at,
      period: { from, to, register },
      steps,
      cash_system_uzs: systemCash,
      cash_counted_uzs: input.cash_counted_uzs ?? null,
      cash_diff_uzs: cashDiff,
      correction_tx_id: correctionTxId,
      moved_to_safe_uzs: movedToSafe,
      settled_uzs: settled,
      before: { closing: before.closing },
      after: { closing: after.closing },
      /** Hozirgi haqiqiy kassa/seyf (davr qoldig'i emas) — ekranda shu ko'rsatiladi. */
      live,
      posted_outside_period: postedOutsidePeriod,
      report: after,
    };
  }

  async listClosings(clinicId: string, register: string) {
    const { data } = await this.supabase
      .admin()
      .from('period_closings')
      .select(
        'id, period_from, period_to, status, cash_system_uzs, cash_counted_uzs, cash_diff_uzs, ' +
          'moved_to_safe_uzs, settled_uzs, notes, closed_at, reopened_at, reopen_reason, ' +
          'closer:profiles!period_closings_closed_by_fkey(full_name)',
      )
      .eq('clinic_id', clinicId)
      .eq('register', register)
      .order('period_to', { ascending: false })
      .limit(36);
    return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      period_from: String(r.period_from),
      period_to: String(r.period_to),
      status: String(r.status) as 'closed' | 'reopened',
      cash_system_uzs: n(r.cash_system_uzs),
      cash_counted_uzs: r.cash_counted_uzs == null ? null : n(r.cash_counted_uzs),
      cash_diff_uzs: n(r.cash_diff_uzs),
      moved_to_safe_uzs: n(r.moved_to_safe_uzs),
      settled_uzs: n(r.settled_uzs),
      notes: (r.notes as string | null) ?? null,
      closed_at: String(r.closed_at),
      reopened_at: (r.reopened_at as string | null) ?? null,
      reopen_reason: (r.reopen_reason as string | null) ?? null,
      closed_by: ((r.closer as { full_name?: string } | null)?.full_name ?? null) as string | null,
    }));
  }

  /** Yopilgan davr snapshot'i — yopilgan kundagi hisobotning o'zgarmas nusxasi. */
  async closingSnapshot(clinicId: string, id: string) {
    const { data } = await this.supabase
      .admin()
      .from('period_closings')
      .select('id, period_from, period_to, snapshot, closed_at')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .maybeSingle();
    if (!data) throw new BadRequestException('Yopish yozuvi topilmadi');
    return data;
  }

  async reopen(clinicId: string, userId: string, id: string, reason: string) {
    const { error } = await this.supabase
      .admin()
      .from('period_closings')
      .update({
        status: 'reopened',
        reopened_at: new Date().toISOString(),
        reopened_by: userId,
        reopen_reason: reason,
      } as never)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .eq('status', 'closed');
    if (error) throw new BadRequestException(error.message);
    // MUHIM: qayta ochish PULNI QAYTARMAYDI — inkasatsiya jismoniy hodisa,
    // uni "bekor qilish" pul seyfdan kassaga qaytdi degani bo'lardi (yolg'on).
    // Kerak bo'lsa seyfdan kassaga alohida yozuv kiritiladi.
    return {
      ok: true,
      note: "Davr ochildi. Inkasatsiya bekor qilinmadi — pul seyfda qoladi (jismoniy holat o'zgarmagan).",
    };
  }
}

// -----------------------------------------------------------------------------
// Controller — moliyaviy ma'lumot, faqat rahbariyat.
// -----------------------------------------------------------------------------
@ApiTags('finance-report')
@Controller({ path: 'finance-report', version: '1' })
@Roles('clinic_admin', 'clinic_owner', 'super_admin')
class FinanceReportController {
  constructor(private readonly svc: FinanceReportService) {}

  @Post('build')
  build(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.report(u.clinicId, ReportSchema.parse(body));
  }

  @Post('drill')
  drill(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.drill(u.clinicId, DrillSchema.parse(body));
  }

  @Post('pdf')
  async pdf(
    @CurrentUser() u: { clinicId: string | null },
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const input = ReportSchema.parse(body);
    const buf = await this.svc.pdf(u.clinicId, input);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="moliyaviy-hisobot-${input.from}_${input.to}.pdf"`,
    );
    res.send(buf);
  }

  @Post('account-ledger')
  ledger(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.accountLedger(u.clinicId, LedgerSchema.parse(body));
  }

  @Get('closings')
  closings(@CurrentUser() u: { clinicId: string | null }, @Query('register') register?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listClosings(u.clinicId, register ?? 'reception');
  }

  @Get('closings/snapshot')
  snapshot(@CurrentUser() u: { clinicId: string | null }, @Query('id') id?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    if (!id) throw new BadRequestException('id kerak');
    return this.svc.closingSnapshot(u.clinicId, id);
  }

  @Post('close')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'finance.period_closed', resourceType: 'period_closings' })
  close(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.closePeriod(u.clinicId, u.userId, CloseSchema.parse(body));
  }

  @Post('reopen')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'finance.period_reopened', resourceType: 'period_closings' })
  reopen(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    const schema = z.object({ id: z.string().uuid(), reason: z.string().min(3).max(500) });
    const { id, reason } = schema.parse(body);
    return this.svc.reopen(u.clinicId, u.userId, id, reason);
  }
}

@Module({
  imports: [CashierModule],
  controllers: [FinanceReportController],
  providers: [FinanceReportService, SupabaseService],
  exports: [FinanceReportService],
})
export class FinanceReportModule {}
