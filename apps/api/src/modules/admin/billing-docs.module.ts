import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { ResendAdapter } from '@clary/notifications';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { SupabaseService } from '../../common/services/supabase.service';

// =============================================================================
// BILLING DOCS — obuna uchun hisob-faktura (invoys) va shartnoma/oferta.
// Faqat super-admin. Pul HARAKATI bu yerda yozilmaydi — invoys "to'landi"
// deb belgilanganda platform_payments'ga yozuv tushadi (audit izi).
// =============================================================================

const MONEY_MAX = 100_000_000_000; // 100 mlrd so'm — typo'dan himoya

const SettingsSchema = z.object({
  company_name: z.string().min(1).max(200).optional(),
  legal_name: z.string().max(300).nullish(),
  tax_id: z.string().max(50).nullish(),
  oked: z.string().max(50).nullish(),
  address: z.string().max(500).nullish(),
  phone: z.string().max(60).nullish(),
  email: z.string().max(200).nullish(),
  website: z.string().max(200).nullish(),
  bank_name: z.string().max(200).nullish(),
  bank_account: z.string().max(60).nullish(),
  bank_mfo: z.string().max(20).nullish(),
  director_name: z.string().max(200).nullish(),
  director_position: z.string().max(100).nullish(),
  vat_percent: z.number().min(0).max(100).optional(),
  invoice_prefix: z.string().min(1).max(20).optional(),
  contract_prefix: z.string().min(1).max(20).optional(),
  invoice_due_days: z.number().int().min(0).max(180).optional(),
  offer_url: z.string().max(300).nullish(),
  offer_version: z.string().max(20).nullish(),
  payment_note: z.string().max(1000).nullish(),
});

const InvoiceItemSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(500).nullish(),
  unit: z.string().max(20).optional(),
  quantity: z.number().min(0).max(100000).optional(),
  unit_price_uzs: z.number().int().min(0).max(MONEY_MAX),
});

const CreateInvoiceSchema = z.object({
  clinic_id: z.string().uuid(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  months: z.number().int().min(1).max(36).default(1),
  plan_code: z.string().max(30).nullish(),
  /** Bo'sh qoldirilsa tarif narxidan avtomatik satr yasaladi. */
  items: z.array(InvoiceItemSchema).max(30).optional(),
  discount_percent: z.number().min(0).max(100).optional(),
  vat_percent: z.number().min(0).max(100).optional(),
  due_days: z.number().int().min(0).max(180).optional(),
  lang: z.enum(['uz', 'ru']).default('uz'),
  notes: z.string().max(2000).nullish(),
});

const CreateContractSchema = z.object({
  clinic_id: z.string().uuid(),
  kind: z.enum(['bilateral', 'offer']).default('bilateral'),
  lang: z.enum(['uz', 'ru']).default('uz'),
  plan_code: z.string().max(30).nullish(),
  monthly_uzs: z.number().int().min(0).max(MONEY_MAX).optional(),
  billing_period: z.enum(['monthly', 'yearly']).default('monthly'),
  starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Bo'sh bo'lsa starts_on + 1 yil. */
  ends_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  notes: z.string().max(2000).nullish(),
});

const EmailDocSchema = z.object({
  /** Mijozda render qilingan hujjat HTML'i — ilova sifatida biriktiriladi. */
  html: z.string().min(50).max(400_000),
  subject: z.string().max(200).optional(),
  message: z.string().max(2000).optional(),
});

type Settings = Record<string, unknown>;

/** Sana(YYYY-MM-DD) ga oy qo'shib, oxirgi kunni qaytaradi (davr tugashi). */
function addMonthsEndOfPeriod(startIso: string, months: number): string {
  const [y, m, d] = startIso.split('-').map(Number);
  // Davr: 01.09 → 30.09 (1 oy). Boshlanish kunidan months oy keyin, 1 kun oldin.
  const end = new Date(Date.UTC(y!, m! - 1 + months, d!));
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

@Injectable()
export class BillingDocsService {
  constructor(private readonly supabase: SupabaseService) {}

  private sb() {
    return this.supabase.admin();
  }

  // --- Rekvizitlar ---------------------------------------------------------

  async getSettings(): Promise<Settings> {
    const { data, error } = await this.sb()
      .from('platform_billing_settings')
      .select('*')
      .eq('id', true)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    // Migratsiya qatorni yaratadi, lekin qo'lda o'chirilgan bo'lsa ham yiqilmaymiz.
    return (data as Settings | null) ?? { id: true };
  }

  async updateSettings(input: z.infer<typeof SettingsSchema>): Promise<Settings> {
    const { data, error } = await this.sb()
      .from('platform_billing_settings')
      .upsert({ id: true, ...input, updated_at: new Date().toISOString() } as never)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data as Settings;
  }

  /** Hujjatga yoziladigan rekvizit ko'chirmasi — keyin o'zgarsa hujjat buzilmasin. */
  private issuerSnapshot(s: Settings) {
    return {
      company_name: s['company_name'] ?? 'Clary Care',
      legal_name: s['legal_name'] ?? null,
      tax_id: s['tax_id'] ?? null,
      oked: s['oked'] ?? null,
      address: s['address'] ?? null,
      phone: s['phone'] ?? null,
      email: s['email'] ?? null,
      website: s['website'] ?? null,
      bank_name: s['bank_name'] ?? null,
      bank_account: s['bank_account'] ?? null,
      bank_mfo: s['bank_mfo'] ?? null,
      director_name: s['director_name'] ?? null,
      director_position: s['director_position'] ?? null,
      payment_note: s['payment_note'] ?? null,
    };
  }

  private async clinicSnapshot(clinicId: string) {
    const { data, error } = await this.sb()
      .from('clinics')
      .select(
        'id, name, legal_name, tax_id, address, city, region, phone, email, current_plan, billing_code',
      )
      .eq('id', clinicId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Klinika topilmadi');
    const c = data as Record<string, unknown>;
    return {
      clinic_id: c['id'],
      name: c['name'],
      legal_name: c['legal_name'] ?? null,
      tax_id: c['tax_id'] ?? null,
      address: [c['address'], c['city'], c['region']].filter(Boolean).join(', ') || null,
      phone: c['phone'] ?? null,
      email: c['email'] ?? null,
      billing_code: c['billing_code'] ?? null,
      current_plan: c['current_plan'] ?? null,
    };
  }

  private async planPrice(code: string | null | undefined) {
    if (!code) return { name: null as string | null, monthly_uzs: 0 };
    const { data } = await this.sb()
      .from('plans')
      .select('name, price_uzs')
      .eq('code', code)
      .maybeSingle();
    const p = data as { name?: string; price_uzs?: number } | null;
    return { name: p?.name ?? null, monthly_uzs: Number(p?.price_uzs ?? 0) };
  }

  private async nextNumber(kind: 'invoice' | 'contract', prefix: string): Promise<string> {
    const { data, error } = await this.sb().rpc(
      'next_billing_number' as never,
      {
        p_kind: kind,
        p_prefix: prefix,
      } as never,
    );
    if (error) throw new BadRequestException(error.message);
    return data as unknown as string;
  }

  // --- Invoys --------------------------------------------------------------

  async listInvoices(params: { clinic_id?: string; status?: string; limit?: number }) {
    let q = this.sb()
      .from('invoices')
      .select('*, clinic:clinics(id, name), items:invoice_items(*)')
      .order('issued_at', { ascending: false })
      .limit(params.limit ?? 200);
    if (params.clinic_id) q = q.eq('clinic_id', params.clinic_id);
    if (params.status) q = q.eq('status', params.status);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((r) => this.withOverdue(r as Record<string, unknown>));
  }

  async getInvoice(id: string) {
    const { data, error } = await this.sb()
      .from('invoices')
      .select('*, clinic:clinics(id, name), items:invoice_items(*)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Invoys topilmadi');
    return this.withOverdue(data as Record<string, unknown>);
  }

  /**
   * "Muddati o'tgan" holatini DB'da emas, O'QISHDA hisoblaymiz — cron kerak
   * emas va sana o'tishi bilan darhol to'g'ri ko'rinadi.
   */
  private withOverdue(row: Record<string, unknown>): Record<string, unknown> {
    const status = String(row['status'] ?? '');
    const dueAt = row['due_at'] ? new Date(String(row['due_at'])) : null;
    const isOverdue = status === 'sent' && !!dueAt && dueAt.getTime() < Date.now();
    const daysLate = isOverdue ? Math.floor((Date.now() - dueAt!.getTime()) / 86_400_000) : 0;
    return { ...row, is_overdue: isOverdue, days_late: daysLate };
  }

  async createInvoice(input: z.infer<typeof CreateInvoiceSchema>, adminId: string | null) {
    const settings = await this.getSettings();
    const customer = await this.clinicSnapshot(input.clinic_id);
    const planCode = input.plan_code ?? (customer.current_plan as string | null);
    const plan = await this.planPrice(planCode);

    // Satrlar: berilmasa tarif narxidan avtomatik ("Clary Care obunasi — 3 oy").
    const items =
      input.items && input.items.length > 0
        ? input.items
        : [
            {
              title: plan.name
                ? `Clary Care — «${plan.name}» tarifi bo'yicha obuna`
                : 'Clary Care — dasturiy ta’minotdan foydalanish obunasi',
              description: null,
              unit: 'oy',
              quantity: input.months,
              unit_price_uzs: plan.monthly_uzs,
            },
          ];

    const rows = items.map((it, i) => {
      const qty = Number(it.quantity ?? 1);
      return {
        position: i,
        title: it.title,
        description: it.description ?? null,
        unit: it.unit ?? 'oy',
        quantity: qty,
        unit_price_uzs: it.unit_price_uzs,
        amount_uzs: Math.round(qty * it.unit_price_uzs),
      };
    });

    const subtotal = rows.reduce((s, r) => s + r.amount_uzs, 0);
    const discountPercent = input.discount_percent ?? 0;
    const discount = Math.round((subtotal * discountPercent) / 100);
    const base = subtotal - discount;
    const vatPercent = input.vat_percent ?? Number(settings['vat_percent'] ?? 0);
    const vat = Math.round((base * vatPercent) / 100);
    const total = base + vat;

    const dueDays = input.due_days ?? Number(settings['invoice_due_days'] ?? 5);
    const periodEnd = addMonthsEndOfPeriod(input.period_start, input.months);
    const issuedIso = new Date().toISOString();
    const number = await this.nextNumber('invoice', String(settings['invoice_prefix'] ?? 'CLARY'));

    const { data: inv, error } = await this.sb()
      .from('invoices')
      .insert({
        clinic_id: input.clinic_id,
        number,
        status: 'draft',
        currency: 'UZS',
        amount_usd_cents: 0,
        plan_code: planCode ?? null,
        months: input.months,
        period_start: input.period_start,
        period_end: periodEnd,
        subtotal_uzs: subtotal,
        discount_percent: discountPercent,
        discount_uzs: discount,
        vat_percent: vatPercent,
        vat_uzs: vat,
        total_uzs: total,
        lang: input.lang,
        issuer: this.issuerSnapshot(settings),
        customer,
        notes: input.notes ?? null,
        issued_at: issuedIso,
        due_at: `${addDays(issuedIso.slice(0, 10), dueDays)}T23:59:59Z`,
        created_by: adminId,
      } as never)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);

    const invoiceId = (inv as { id: string }).id;
    const { error: itemsErr } = await this.sb()
      .from('invoice_items')
      .insert(rows.map((r) => ({ ...r, invoice_id: invoiceId })) as never);
    if (itemsErr) {
      // Satrlar yozilmasa yarim invoys qolmasin.
      await this.sb().from('invoices').delete().eq('id', invoiceId);
      throw new BadRequestException(itemsErr.message);
    }

    return this.getInvoice(invoiceId);
  }

  async setInvoiceStatus(
    id: string,
    action: 'send' | 'pay' | 'void' | 'draft',
    body: { paid_at?: string; payment_method?: string; reason?: string },
    adminId: string | null,
  ) {
    const current = await this.getInvoice(id);
    if (String(current['status']) === 'void' && action !== 'draft')
      throw new BadRequestException('Bekor qilingan invoysni o‘zgartirib bo‘lmaydi');

    const patch: Record<string, unknown> = {};
    if (action === 'send') {
      patch['status'] = 'sent';
      patch['sent_at'] = new Date().toISOString();
    } else if (action === 'pay') {
      patch['status'] = 'paid';
      patch['paid_at'] = body.paid_at ?? new Date().toISOString();
      patch['payment_method'] = body.payment_method ?? 'bank';
    } else if (action === 'void') {
      patch['status'] = 'void';
      patch['voided_at'] = new Date().toISOString();
      patch['void_reason'] = body.reason ?? null;
    } else {
      patch['status'] = 'draft';
      patch['sent_at'] = null;
      patch['paid_at'] = null;
      patch['voided_at'] = null;
    }

    const { error } = await this.sb()
      .from('invoices')
      .update(patch as never)
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);

    // To'landi → platform_payments'ga audit yozuvi (Tushum sahifasi shundan o'qiydi).
    if (action === 'pay') {
      await this.sb()
        .from('platform_payments')
        .insert({
          clinic_id: current['clinic_id'],
          invoice_id: id,
          amount_usd_cents: 0,
          status: 'invoice_paid',
          succeeded_at: patch['paid_at'],
          notes:
            `Invoys ${current['number']} to‘landi: ` +
            `${Number(current['total_uzs'] ?? 0).toLocaleString('uz-UZ')} so‘m ` +
            `(${body.payment_method ?? 'bank'}) — admin ${adminId ?? '—'}`,
        } as never)
        .then(() => {});
    }

    return this.getInvoice(id);
  }

  async deleteInvoice(id: string) {
    const current = await this.getInvoice(id);
    // To'langan invoysni o'chirish moliyaviy izni buzadi — faqat bekor qilinadi.
    if (String(current['status']) === 'paid')
      throw new BadRequestException(
        'To‘langan invoysni o‘chirib bo‘lmaydi — "Bekor qilish"dan foydalaning',
      );
    const { error } = await this.sb().from('invoices').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // --- Shartnoma -----------------------------------------------------------

  async listContracts(params: { clinic_id?: string; status?: string; limit?: number }) {
    let q = this.sb()
      .from('contracts')
      .select('*, clinic:clinics(id, name)')
      .order('created_at', { ascending: false })
      .limit(params.limit ?? 200);
    if (params.clinic_id) q = q.eq('clinic_id', params.clinic_id);
    if (params.status) q = q.eq('status', params.status);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getContract(id: string) {
    const { data, error } = await this.sb()
      .from('contracts')
      .select('*, clinic:clinics(id, name)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Shartnoma topilmadi');
    return data;
  }

  async createContract(input: z.infer<typeof CreateContractSchema>, adminId: string | null) {
    const settings = await this.getSettings();
    const customer = await this.clinicSnapshot(input.clinic_id);
    const planCode = input.plan_code ?? (customer.current_plan as string | null);
    const plan = await this.planPrice(planCode);
    const monthly = input.monthly_uzs ?? plan.monthly_uzs;

    // Muddat ko'rsatilmasa — 1 yil (avtomatik uzayadi, shartnomada yozilgan).
    const ends = input.ends_on ?? addDays(addMonthsEndOfPeriod(input.starts_on, 12), 0);

    const number = await this.nextNumber(
      'contract',
      String(settings['contract_prefix'] ?? 'CLARY-SH'),
    );

    const { data, error } = await this.sb()
      .from('contracts')
      .insert({
        clinic_id: input.clinic_id,
        number,
        kind: input.kind,
        status: 'draft',
        lang: input.lang,
        plan_code: planCode ?? null,
        monthly_uzs: monthly,
        billing_period: input.billing_period,
        starts_on: input.starts_on,
        ends_on: ends,
        issuer: this.issuerSnapshot(settings),
        customer,
        terms_version: String(settings['offer_version'] ?? '1.0'),
        notes: input.notes ?? null,
        created_by: adminId,
      } as never)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return this.getContract((data as { id: string }).id);
  }

  async setContractStatus(
    id: string,
    action: 'send' | 'sign' | 'terminate' | 'draft',
    body: { signed_at?: string },
  ) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (action === 'send') patch['status'] = 'sent';
    else if (action === 'sign') {
      patch['status'] = 'signed';
      patch['signed_at'] = body.signed_at ?? new Date().toISOString();
    } else if (action === 'terminate') {
      patch['status'] = 'terminated';
      patch['terminated_at'] = new Date().toISOString();
    } else {
      patch['status'] = 'draft';
      patch['signed_at'] = null;
      patch['terminated_at'] = null;
    }
    const { error } = await this.sb()
      .from('contracts')
      .update(patch as never)
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return this.getContract(id);
  }

  async deleteContract(id: string) {
    const c = (await this.getContract(id)) as Record<string, unknown>;
    if (String(c['status']) === 'signed')
      throw new BadRequestException(
        'Imzolangan shartnomani o‘chirib bo‘lmaydi — "Bekor qilish"dan foydalaning',
      );
    const { error } = await this.sb().from('contracts').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // --- Hujjatni klinikaga e-pochta orqali jo'natish ------------------------

  /**
   * Klinikaning HAQIQIY e-pochta manzillari. Ustuvorlik:
   *   1) clinics.email — super-admin qo'lda kiritgan rasmiy manzil
   *   2) rahbariyat profillari (clinic_admin / clinic_owner)
   *   3) istalgan xodim
   * Avtomatik yaratilgan soxta manzillar (@demo.clary.uz, @clary.local) chetlab
   * o'tiladi — ularga yuborilsa hard bounce bo'lib domen obro'si kuyadi.
   */
  private async clinicEmails(clinicId: string): Promise<string[]> {
    const admin = this.sb();
    const FAKE = ['@demo.clary.uz', '@clary.local', '@example.com'];
    const isReal = (e: string) => {
      const v = e.trim().toLowerCase();
      if (!v.includes('@') || v.endsWith('.local') || v.endsWith('.test')) return false;
      return !FAKE.some((d) => v.endsWith(d));
    };

    const { data: c } = await admin
      .from('clinics')
      .select('email')
      .eq('id', clinicId)
      .maybeSingle();
    const official = (c as { email?: string | null } | null)?.email;
    if (official && isReal(official)) return [official.trim()];

    const { data: profs } = await admin
      .from('profiles')
      .select('email, role')
      .eq('clinic_id', clinicId)
      .not('email', 'is', null);
    const staff = (profs ?? []) as Array<{ email: string | null; role: string | null }>;
    const pick = (f: (r: (typeof staff)[number]) => boolean) => [
      ...new Set(
        staff
          .filter((r) => f(r) && r.email && isReal(r.email))
          .map((r) => r.email!.trim().toLowerCase()),
      ),
    ];
    const leads = pick((r) => r.role === 'clinic_admin' || r.role === 'clinic_owner');
    return leads.length > 0 ? leads : pick(() => true);
  }

  /**
   * Hujjat HTML'i mijozda (admin panelda) render qilinadi va shu yerga keladi —
   * serverda bosh brauzer yo'q, shuning uchun PDF emas, HTML ilova yuboriladi
   * (klinika ochib chop etadi yoki PDF qilib saqlaydi).
   */
  async emailDoc(
    kind: 'invoice' | 'contract',
    id: string,
    input: { html: string; subject?: string; message?: string },
    adminId: string | null,
  ) {
    const doc = (
      kind === 'invoice' ? await this.getInvoice(id) : await this.getContract(id)
    ) as Record<string, unknown>;
    const clinicId = String(doc['clinic_id']);
    const number = String(doc['number'] ?? '');

    const apiKey = process.env.PLATFORM_RESEND_API_KEY || process.env.RESEND_API_KEY;
    if (!apiKey?.trim())
      throw new BadRequestException('PLATFORM_RESEND_API_KEY sozlanmagan — e-pochta yuborilmaydi');

    const emails = await this.clinicEmails(clinicId);
    if (emails.length === 0)
      throw new BadRequestException(
        'Klinikaning haqiqiy e-pochta manzili topilmadi. Klinika kartasida rasmiy manzilni kiriting.',
      );

    const settings = await this.getSettings();
    const isInvoice = kind === 'invoice';
    const title = isInvoice ? `Hisob-faktura ${number}` : `Shartnoma ${number}`;
    const clinicName = String(
      (doc['customer'] as Record<string, unknown> | null)?.['name'] ?? 'Hamkorimiz',
    );

    const summaryRows = isInvoice
      ? [
          ['Hujjat', number],
          ['Davr', `${String(doc['period_start'] ?? '—')} — ${String(doc['period_end'] ?? '—')}`],
          ["To'lov muddati", doc['due_at'] ? String(doc['due_at']).slice(0, 10) : '—'],
          ['Summa', `${Number(doc['total_uzs'] ?? 0).toLocaleString('uz-UZ')} so'm`],
        ]
      : [
          ['Hujjat', number],
          ['Muddat', `${String(doc['starts_on'] ?? '—')} — ${String(doc['ends_on'] ?? '—')}`],
          ['Oylik', `${Number(doc['monthly_uzs'] ?? 0).toLocaleString('uz-UZ')} so'm`],
        ];

    const rowsHtml = summaryRows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:5px 0;color:#7c7364">${k}</td>` +
          `<td style="padding:5px 0;font-weight:600;text-align:right">${v}</td></tr>`,
      )
      .join('');

    const body = `<div style="font-family:Georgia,'Times New Roman',serif;color:#1c1b19;max-width:560px;margin:0 auto">
      <div style="font-size:20px;letter-spacing:.18em;text-transform:uppercase">Clary</div>
      <div style="font-size:9px;letter-spacing:.2em;color:#9a8f7d;text-transform:uppercase">Healthcare ERP</div>
      <hr style="border:0;height:1px;background:#b08d4f;margin:12px 0 16px">
      <p style="line-height:1.6;margin:0 0 12px">Hurmatli <b>${clinicName}</b>!</p>
      <p style="line-height:1.6;margin:0 0 14px">${
        input.message ??
        (isInvoice
          ? "Obuna to'lovi uchun hisob-faktura ilova qilinadi. To'lov rekvizitlari hujjat ichida ko'rsatilgan."
          : 'Hamkorlik shartnomasi loyihasi ilova qilinadi. Tanishib chiqib, imzolangan nusxani qaytarishingizni so‘raymiz.')
      }</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${rowsHtml}</table>
      <p style="line-height:1.6;margin:16px 0 0">
        Hamkorligingiz va bildirgan ishonchingiz uchun samimiy minnatdorlik bildiramiz.
      </p>
      <p style="margin:14px 0 0">
        Hurmat bilan,<br>
        <b>${String(settings['director_name'] ?? '')}</b><br>
        <span style="color:#7c7364;font-size:13px">${String(settings['director_position'] ?? '')}, ${String(settings['company_name'] ?? 'Clary Care')}</span>
      </p>
      <p style="margin:18px 0 0;color:#a89e8d;font-size:11px">
        Ilovadagi faylni brauzerda ochib chop eting yoki PDF sifatida saqlang.
      </p>
    </div>`;

    const adapter = new ResendAdapter({
      api_key: apiKey,
      from_default:
        process.env.PLATFORM_RESEND_FROM ?? process.env.RESEND_FROM ?? 'Clary <hello@clary.uz>',
    });
    const res = await adapter.send({
      to: emails,
      subject: input.subject ?? `Clary — ${title}`,
      html: body,
      text: `${title}. Hujjat ilovada.`,
      attachments: [{ filename: `${number || kind}.html`, content: input.html }],
    });
    if (res.status !== 'sent') throw new BadRequestException(res.error ?? 'E-pochta yuborilmadi');

    // Yuborilgach holat "sent" ga o'tadi (qoralama bo'lsa).
    const table = isInvoice ? 'invoices' : 'contracts';
    const patch: Record<string, unknown> = isInvoice
      ? {
          status: doc['status'] === 'draft' ? 'sent' : doc['status'],
          sent_at: new Date().toISOString(),
        }
      : { status: doc['status'] === 'draft' ? 'sent' : doc['status'] };
    await this.sb()
      .from(table)
      .update(patch as never)
      .eq('id', id);

    await this.sb()
      .from('platform_payments')
      .insert({
        clinic_id: clinicId,
        invoice_id: isInvoice ? id : null,
        amount_usd_cents: 0,
        status: 'doc_emailed',
        notes: `${title} → ${emails.join(', ')} (admin ${adminId ?? '—'})`,
      } as never)
      .then(() => {});

    return { ok: true, sent_to: emails };
  }

  // --- Yig'ma ko'rsatkich (sahifa yuqorisidagi kartalar) --------------------

  async summary() {
    const { data } = await this.sb()
      .from('invoices')
      .select('status, total_uzs, due_at')
      .neq('status', 'void');
    const rows = (data ?? []) as Array<{
      status: string;
      total_uzs: number;
      due_at: string | null;
    }>;
    const now = Date.now();
    let paid = 0;
    let awaiting = 0;
    let overdue = 0;
    let overdueCount = 0;
    for (const r of rows) {
      const amt = Number(r.total_uzs ?? 0);
      if (r.status === 'paid') paid += amt;
      else if (r.status === 'sent') {
        const late = r.due_at ? new Date(r.due_at).getTime() < now : false;
        if (late) {
          overdue += amt;
          overdueCount++;
        } else awaiting += amt;
      }
    }
    return {
      paid_total_uzs: paid,
      awaiting_uzs: awaiting,
      overdue_uzs: overdue,
      overdue_count: overdueCount,
      invoices_count: rows.length,
    };
  }
}

@ApiTags('admin')
@Controller('admin/billing')
@UseGuards(SuperAdminGuard)
class BillingDocsController {
  constructor(private readonly svc: BillingDocsService) {}

  @Get('settings')
  settings() {
    return this.svc.getSettings();
  }

  @Patch('settings')
  updateSettings(@Body() body: unknown) {
    return this.svc.updateSettings(SettingsSchema.parse(body ?? {}));
  }

  @Get('summary')
  summary() {
    return this.svc.summary();
  }

  @Get('invoices')
  listInvoices(
    @Query('clinic_id') clinicId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listInvoices({
      clinic_id: clinicId,
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('invoices/:id')
  invoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getInvoice(id);
  }

  @Post('invoices')
  createInvoice(@CurrentUser() u: { userId: string | null }, @Body() body: unknown) {
    return this.svc.createInvoice(CreateInvoiceSchema.parse(body), u.userId);
  }

  @Post('invoices/:id/:action')
  invoiceAction(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action') action: string,
    @Body() body: { paid_at?: string; payment_method?: string; reason?: string },
  ) {
    if (!['send', 'pay', 'void', 'draft'].includes(action))
      throw new BadRequestException('Noma’lum amal');
    return this.svc.setInvoiceStatus(
      id,
      action as 'send' | 'pay' | 'void' | 'draft',
      body ?? {},
      u.userId,
    );
  }

  @Post('invoices/:id/delete')
  deleteInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteInvoice(id);
  }

  @Post('invoices/:id/email')
  emailInvoice(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.svc.emailDoc('invoice', id, EmailDocSchema.parse(body), u.userId);
  }

  @Get('contracts')
  listContracts(
    @Query('clinic_id') clinicId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listContracts({
      clinic_id: clinicId,
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('contracts/:id')
  contract(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getContract(id);
  }

  @Post('contracts')
  createContract(@CurrentUser() u: { userId: string | null }, @Body() body: unknown) {
    return this.svc.createContract(CreateContractSchema.parse(body), u.userId);
  }

  @Post('contracts/:id/:action')
  contractAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action') action: string,
    @Body() body: { signed_at?: string },
  ) {
    if (!['send', 'sign', 'terminate', 'draft'].includes(action))
      throw new BadRequestException('Noma’lum amal');
    return this.svc.setContractStatus(
      id,
      action as 'send' | 'sign' | 'terminate' | 'draft',
      body ?? {},
    );
  }

  @Post('contracts/:id/delete')
  deleteContract(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteContract(id);
  }

  @Post('contracts/:id/email')
  emailContract(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.svc.emailDoc('contract', id, EmailDocSchema.parse(body), u.userId);
  }
}

@Module({
  controllers: [BillingDocsController],
  providers: [BillingDocsService, SupabaseService],
  exports: [BillingDocsService],
})
export class BillingDocsModule {}
