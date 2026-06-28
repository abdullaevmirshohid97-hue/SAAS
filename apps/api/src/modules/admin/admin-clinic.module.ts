import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module,
  NotFoundException, Param, ParseUUIDPipe, Post, UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { SupabaseService } from '../../common/services/supabase.service';
import { TelegramReportsModule, TelegramReportsService } from '../telegram-reports/telegram-reports.module';
import { InsuranceModule, InsuranceService } from '../insurance/insurance.module';

// =============================================================================
// Super-admin "Batafsil" — klinika boshqaruvi: billing xabar (in-app+telegram),
// filial bog'lash, sug'urta, eslatmalar. Filial/sug'urta faqat Enterprise (120pro).
// =============================================================================
const MessageSchema = z.object({
  channels: z.array(z.enum(['in_app', 'telegram'])).min(1),
  plan_snapshot: z.string().optional(),
  amount_uzs: z.number().int().nonnegative().optional(),
  pay_date: z.string().optional(),
  contact_phone: z.string().optional(),
  note: z.string().optional(),
});
const ContractInput = z.object({
  name: z.string().min(1),
  provider_id: z.string().uuid().optional(),
  copay_percent: z.number().min(0).max(100).optional(),
  covered_category_ids: z.array(z.string().uuid()).optional(),
  contract_start: z.string().optional(),
  contract_end: z.string().optional(),
  max_benefit_uzs: z.number().int().nonnegative().optional(),
});

const DEFAULT_CONTACT = '+998770414020';

@Injectable()
export class AdminClinicService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly telegram: TelegramReportsService,
    private readonly insurance: InsuranceService,
  ) {}

  private async clinic(id: string) {
    const { data } = await this.supabase.admin()
      .from('clinics').select('id, name, current_plan, company_id').eq('id', id).maybeSingle();
    if (!data) throw new NotFoundException('Klinika topilmadi');
    return data as { id: string; name: string; current_plan: string | null; company_id: string | null };
  }

  private async assertEnterprise(id: string) {
    const c = await this.clinic(id);
    if (c.current_plan !== '120pro') throw new ForbiddenException('Bu funksiya faqat Enterprise (120pro) tarifda mavjud');
    return c;
  }

  // ── Billing xabar ──
  async sendMessage(clinicId: string, userId: string | null, body: z.infer<typeof MessageSchema>) {
    const admin = this.supabase.admin();
    const c = await this.clinic(clinicId);
    const plan = body.plan_snapshot ?? c.current_plan ?? '-';
    const contact = body.contact_phone || DEFAULT_CONTACT;
    const text = `Hurmatli ${c.name}! Joriy tarif: ${plan}.`
      + (body.amount_uzs ? ` To'lov summasi: ${Number(body.amount_uzs).toLocaleString('uz-UZ')} so'm.` : '')
      + (body.pay_date ? ` To'lov sanasi: ${body.pay_date}.` : '')
      + (body.note ? ` ${body.note}` : '')
      + ` Aloqa uchun ${contact} ga murojaat qiling.`;
    const result = { in_app: false, telegram: false };
    if (body.channels.includes('in_app')) {
      await admin.from('clinic_announcements').insert({
        clinic_id: clinicId, title: "Obuna / to'lov eslatmasi", body: text,
        plan_snapshot: plan, amount_uzs: body.amount_uzs ?? null, pay_date: body.pay_date ?? null,
        contact_phone: contact, created_by: userId,
      });
      result.in_app = true;
    }
    if (body.channels.includes('telegram')) {
      try { await this.telegram.sendToOwners(clinicId, text); result.telegram = true; }
      catch { /* telegram bot ulanmagan bo'lishi mumkin — in-app baribir yuboriladi */ }
    }
    return result;
  }

  // ── Filiallar (Enterprise) ──
  async branches(clinicId: string) {
    const c = await this.clinic(clinicId);
    if (!c.company_id) return { company_id: null, branches: [] };
    const { data } = await this.supabase.admin()
      .from('clinics').select('id, name, is_hq, branch_code, current_plan, city')
      .eq('company_id', c.company_id).is('deleted_at', null).order('is_hq', { ascending: false });
    return { company_id: c.company_id, branches: data ?? [] };
  }

  async linkBranch(clinicId: string, branchClinicId: string) {
    if (branchClinicId === clinicId) throw new BadRequestException('Klinikani o\'ziga bog\'lab bo\'lmaydi');
    const c = await this.assertEnterprise(clinicId);
    const admin = this.supabase.admin();
    await admin.from('clinics').update({ company_id: c.company_id, is_hq: false }).eq('id', branchClinicId);
    await admin.from('clinics').update({ is_hq: true }).eq('id', clinicId);
    if (c.company_id) await admin.from('companies').update({ package: 'enterprise' }).eq('id', c.company_id);
    return { ok: true };
  }

  async unlinkBranch(clinicId: string, branchClinicId: string) {
    await this.assertEnterprise(clinicId);
    const admin = this.supabase.admin();
    const { data: bc } = await admin.from('clinics').select('name, country, currency').eq('id', branchClinicId).maybeSingle();
    const b = bc as { name: string; country: string | null; currency: string | null } | null;
    const { data: co } = await admin.from('companies')
      .insert({ name: b?.name ?? 'Klinika', country: b?.country ?? 'UZ', base_currency: b?.currency ?? 'UZS', package: 'small' })
      .select('id').single();
    await admin.from('clinics').update({ company_id: (co as { id: string }).id, is_hq: true }).eq('id', branchClinicId);
    return { ok: true };
  }

  // ── Sug'urta (Enterprise) — InsuranceService'ni target clinic bilan ──
  async insuranceContracts(clinicId: string) {
    await this.assertEnterprise(clinicId);
    return this.insurance.listContracts(clinicId);
  }
  async linkInsurance(clinicId: string, userId: string | null, body: z.infer<typeof ContractInput>) {
    await this.assertEnterprise(clinicId);
    return this.insurance.createContract(clinicId, userId, body);
  }

  // ── Eslatmalar ──
  async reminders(clinicId: string) {
    const { data } = await this.supabase.admin()
      .from('clinic_reminders').select('*').eq('clinic_id', clinicId).order('created_at', { ascending: false }).limit(100);
    return data ?? [];
  }
  async addReminder(clinicId: string, userId: string | null, note: string) {
    await this.supabase.admin().from('clinic_reminders').insert({ clinic_id: clinicId, note, created_by: userId });
    return { ok: true };
  }
  async doneReminder(clinicId: string, id: string) {
    await this.supabase.admin().from('clinic_reminders').update({ is_done: true }).eq('clinic_id', clinicId).eq('id', id);
    return { ok: true };
  }
}

@ApiTags('admin')
@Controller('admin')
@UseGuards(SuperAdminGuard)
class AdminClinicController {
  constructor(private readonly svc: AdminClinicService) {}

  @Post('tenants/:id/message')
  message(@CurrentUser() u: { userId: string | null }, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.svc.sendMessage(id, u.userId ?? null, MessageSchema.parse(body));
  }

  @Get('tenants/:id/branches')
  branches(@Param('id', ParseUUIDPipe) id: string) { return this.svc.branches(id); }

  @Post('tenants/:id/branches/link')
  linkBranch(@Param('id', ParseUUIDPipe) id: string, @Body() body: { branch_clinic_id: string }) {
    return this.svc.linkBranch(id, body.branch_clinic_id);
  }

  @Post('tenants/:id/branches/unlink')
  unlinkBranch(@Param('id', ParseUUIDPipe) id: string, @Body() body: { branch_clinic_id: string }) {
    return this.svc.unlinkBranch(id, body.branch_clinic_id);
  }

  @Get('tenants/:id/insurance')
  insurance(@Param('id', ParseUUIDPipe) id: string) { return this.svc.insuranceContracts(id); }

  @Post('tenants/:id/insurance')
  linkInsurance(@CurrentUser() u: { userId: string | null }, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.svc.linkInsurance(id, u.userId ?? null, ContractInput.parse(body));
  }

  @Get('tenants/:id/reminders')
  reminders(@Param('id', ParseUUIDPipe) id: string) { return this.svc.reminders(id); }

  @Post('tenants/:id/reminders')
  addReminder(@CurrentUser() u: { userId: string | null }, @Param('id', ParseUUIDPipe) id: string, @Body() body: { note: string }) {
    return this.svc.addReminder(id, u.userId ?? null, (body?.note ?? '').trim());
  }

  @Post('tenants/:id/reminders/:rid/done')
  doneReminder(@Param('id', ParseUUIDPipe) id: string, @Param('rid', ParseUUIDPipe) rid: string) {
    return this.svc.doneReminder(id, rid);
  }
}

@Module({
  imports: [TelegramReportsModule, InsuranceModule],
  controllers: [AdminClinicController],
  providers: [AdminClinicService, SupabaseService],
})
export class AdminClinicModule {}
