import {
  Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// =============================================================================
// QISM 0 — Kompaniya (multi-branch): CEO ko'rinishi + konsolidatsiya.
// Kompaniya foydalanuvchining FILIALIDAN (JWT clinic_id) aniqlanadi — boshqa
// kompaniyani ko'ra olmaydi. Read-only (auth-kontekst o'zgartirilmaydi).
// =============================================================================

function monthRange(from?: string, to?: string): { from: string; to: string } {
  if (from && to) return { from, to };
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: start.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

@Injectable()
export class CompanyService {
  constructor(private readonly supabase: SupabaseService) {}

  private async resolveCompany(clinicId: string): Promise<string | null> {
    const { data } = await this.supabase.admin().from('clinics').select('company_id').eq('id', clinicId).maybeSingle();
    return (data as { company_id: string | null } | null)?.company_id ?? null;
  }

  async getMyCompany(clinicId: string) {
    const companyId = await this.resolveCompany(clinicId);
    if (!companyId) throw new NotFoundException('Kompaniya topilmadi');
    const admin = this.supabase.admin();
    const { data: company } = await admin
      .from('companies')
      .select('id, name, package, base_currency, country')
      .eq('id', companyId).maybeSingle();
    const { data: branches } = await admin
      .from('clinics')
      .select('id, name, branch_code, is_hq, city')
      .eq('company_id', companyId).is('deleted_at', null)
      .order('is_hq', { ascending: false }).order('name');
    return { company, branches: branches ?? [], branch_count: (branches ?? []).length };
  }

  async consolidated(clinicId: string, from: string, to: string) {
    const companyId = await this.resolveCompany(clinicId);
    if (!companyId) throw new NotFoundException('Kompaniya topilmadi');
    const { data, error } = await this.supabase.admin()
      .rpc('company_consolidated_activity', { p_company: companyId, p_from: from, p_to: to });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ clinic_id: string; clinic_name: string; type: string; debit: number; credit: number }>;

    const branchMap = new Map<string, { clinic_id: string; clinic_name: string; income: number; expense: number; profit: number }>();
    let income = 0, expense = 0;
    for (const r of rows) {
      const b = branchMap.get(r.clinic_id) ?? { clinic_id: r.clinic_id, clinic_name: r.clinic_name, income: 0, expense: 0, profit: 0 };
      if (r.type === 'income') { const v = Number(r.credit) - Number(r.debit); b.income += v; income += v; }
      else if (r.type === 'expense') { const v = Number(r.debit) - Number(r.credit); b.expense += v; expense += v; }
      branchMap.set(r.clinic_id, b);
    }
    const branches = [...branchMap.values()]
      .map((b) => ({ ...b, profit: b.income - b.expense }))
      .sort((a, b) => b.profit - a.profit);
    return {
      from, to,
      branches, // foyda bo'yicha reyting (eng yaxshi filial yuqorida)
      consolidated: { income, expense, profit: income - expense },
    };
  }
}

@ApiTags('company')
@Controller({ path: 'company', version: '1' })
class CompanyController {
  constructor(private readonly svc: CompanyService) {}

  @Get('my')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  my(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getMyCompany(u.clinicId);
  }

  @Get('consolidated')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  consolidated(@CurrentUser() u: { clinicId: string | null }, @Query('from') from?: string, @Query('to') to?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    const r = monthRange(from, to);
    return this.svc.consolidated(u.clinicId, r.from, r.to);
  }
}

@Module({
  controllers: [CompanyController],
  providers: [CompanyService, SupabaseService],
})
export class CompanyModule {}
