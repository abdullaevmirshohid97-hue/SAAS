import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { invalidateNetworkScope } from '../../common/network/network-scope';
import { SupabaseService } from '../../common/services/supabase.service';
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_JOURNAL_PIN_HASH } from '../auth/auth.service';
import { CompanyModule } from '../company/company.module';
import { MemberInput, NetworkService } from '../company/network.service';

// =============================================================================
// Super-admin — FILIAL TARMOQLARI. Bir joydan 10 tagacha filial: tarmoq yaratish
// (asosiy klinika = HQ), mavjud klinikani filial qilib ulash / ajratish, HQ'ni
// almashtirish, noldan yangi filial ochish (katalog HQ'dan), a'zolar va billing.
// Barcha og'ir amallar atomik RPC'da (migratsiya 20261016000002).
// =============================================================================

const ConfigureInput = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  max_branches: z.number().int().min(1).max(10).optional(),
  billing_mode: z.enum(['per_branch', 'company']).optional(),
  branch_fee_uzs: z.number().int().min(0).optional(),
  package: z.enum(['small', 'business', 'enterprise']).optional(),
  shared_patients: z.boolean().optional(),
});
const ClinicRef = z.object({ clinic_id: z.string().uuid() });
const NewBranchInput = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{2,40}$/, 'slug: lotin harf, raqam va "-" (3–41 belgi)'),
  city: z.string().trim().max(80).optional(),
  branch_code: z.string().trim().max(20).optional(),
  copy_catalog: z.boolean().default(true),
  copy_settings: z.boolean().default(true),
  manager_email: z.string().email().optional(),
  manager_full_name: z.string().trim().max(120).optional(),
});

type ClinicRow = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  is_hq: boolean;
  company_id: string | null;
  branch_code: string | null;
  branch_color: string | null;
  current_plan: string;
  subscription_status: string;
  trial_ends_at: string | null;
  created_at: string;
};

@Injectable()
export class AdminNetworkService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly network: NetworkService,
  ) {}

  private rpcError(error: { message: string }): never {
    throw new BadRequestException(error.message);
  }

  async list() {
    const admin = this.supabase.admin();
    const [{ data: companies, error }, { data: clinics }] = await Promise.all([
      admin
        .from('companies')
        .select(
          'id, name, package, max_branches, billing_mode, branch_fee_uzs, shared_patients, created_at',
        ),
      admin
        .from('clinics')
        .select(
          'id, name, slug, city, is_hq, company_id, current_plan, subscription_status, created_at',
        )
        .is('deleted_at', null),
    ]);
    if (error) throw new BadRequestException(error.message);
    const byCompany = new Map<string, ClinicRow[]>();
    for (const c of (clinics ?? []) as ClinicRow[]) {
      if (!c.company_id) continue;
      const arr = byCompany.get(c.company_id) ?? [];
      arr.push(c);
      byCompany.set(c.company_id, arr);
    }
    return (
      (companies ?? []) as Array<
        Record<string, unknown> & { id: string; name: string; max_branches: number }
      >
    )
      .map((co) => {
        const branches = byCompany.get(co.id) ?? [];
        const hq = branches.find((b) => b.is_hq) ?? null;
        return {
          ...co,
          branch_count: branches.length,
          is_network: branches.length > 1 || co.max_branches > 1,
          hq: hq
            ? {
                id: hq.id,
                name: hq.name,
                slug: hq.slug,
                plan: hq.current_plan,
                status: hq.subscription_status,
              }
            : null,
          branches: branches
            .sort((a, b) => Number(b.is_hq) - Number(a.is_hq) || a.name.localeCompare(b.name))
            .map((b) => ({ id: b.id, name: b.name, is_hq: b.is_hq, city: b.city })),
        };
      })
      .filter((co) => co.branch_count > 0)
      .sort(
        (a, b) =>
          Number(b.is_network) - Number(a.is_network) ||
          b.branch_count - a.branch_count ||
          a.name.localeCompare(b.name),
      );
  }

  async detail(companyId: string) {
    const admin = this.supabase.admin();
    const { data: company } = await admin
      .from('companies')
      .select(
        'id, name, legal_name, package, max_branches, billing_mode, branch_fee_uzs, shared_patients, created_at',
      )
      .eq('id', companyId)
      .maybeSingle();
    if (!company) throw new NotFoundException('Tarmoq topilmadi');
    const { data: clinicsRaw } = await admin
      .from('clinics')
      .select(
        'id, name, slug, city, is_hq, company_id, branch_code, branch_color, current_plan, subscription_status, trial_ends_at, created_at',
      )
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('is_hq', { ascending: false })
      .order('name');
    const clinics = (clinicsRaw ?? []) as ClinicRow[];
    const ids = clinics.map((c) => c.id);

    const counts = await Promise.all(
      clinics.map(async (c) => {
        const [p, s] = await Promise.all([
          admin
            .from('patients')
            .select('id', { count: 'exact', head: true })
            .eq('clinic_id', c.id)
            .is('deleted_at', null),
          admin
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .eq('clinic_id', c.id)
            .is('deleted_at', null),
        ]);
        return { id: c.id, patients: p.count ?? 0, staff: s.count ?? 0 };
      }),
    );
    const countMap = new Map(counts.map((c) => [c.id, c]));

    const [members, { data: audit }, billing] = await Promise.all([
      this.network.listMembers(companyId),
      admin
        .from('company_audit_log')
        .select('id, clinic_id, actor_id, action, detail, created_at')
        .eq('company_id', companyId)
        .neq('action', 'branch_switch')
        .order('created_at', { ascending: false })
        .limit(50),
      this.billingEstimate(company as { billing_mode: string; branch_fee_uzs: number }, clinics),
    ]);

    return {
      company,
      branches: clinics.map((c) => ({
        ...c,
        patients: countMap.get(c.id)?.patients ?? 0,
        staff: countMap.get(c.id)?.staff ?? 0,
      })),
      branch_ids: ids,
      members,
      audit: audit ?? [],
      billing,
    };
  }

  private async billingEstimate(
    company: { billing_mode: string; branch_fee_uzs: number },
    clinics: ClinicRow[],
  ) {
    const { data: plans } = await this.supabase
      .admin()
      .from('plans')
      .select('code, name, price_uzs');
    const price = new Map(
      ((plans ?? []) as Array<{ code: string; name: string; price_uzs: number | null }>).map(
        (p) => [p.code, Number(p.price_uzs ?? 0)],
      ),
    );
    const hq = clinics.find((c) => c.is_hq) ?? null;
    const branchCount = Math.max(0, clinics.length - 1);
    if (company.billing_mode === 'company') {
      const hqPrice = hq ? (price.get(hq.current_plan) ?? 0) : 0;
      const fee = Number(company.branch_fee_uzs ?? 0);
      return {
        mode: 'company' as const,
        hq_plan: hq?.current_plan ?? null,
        hq_price_uzs: hqPrice,
        branch_fee_uzs: fee,
        branches: branchCount,
        monthly_total_uzs: hqPrice + branchCount * fee,
      };
    }
    const lines = clinics.map((c) => ({
      clinic_id: c.id,
      plan: c.current_plan,
      price_uzs: price.get(c.current_plan) ?? 0,
    }));
    return {
      mode: 'per_branch' as const,
      lines,
      monthly_total_uzs: lines.reduce((s, l) => s + l.price_uzs, 0),
    };
  }

  async configure(
    companyId: string,
    patch: z.infer<typeof ConfigureInput>,
    actorId: string | null,
  ) {
    if (Object.keys(patch).length === 0)
      throw new BadRequestException("Hech narsa o'zgartirilmadi");
    const admin = this.supabase.admin();
    if (patch.max_branches !== undefined) {
      const { count } = await admin
        .from('clinics')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .is('deleted_at', null);
      if ((count ?? 0) > patch.max_branches) {
        throw new BadRequestException(
          `Tarmoqda hozir ${count} ta filial — limitni undan kichik qilib bo'lmaydi`,
        );
      }
    }
    const { error } = await admin.from('companies').update(patch).eq('id', companyId);
    if (error) throw new BadRequestException(error.message);
    if (patch.shared_patients !== undefined) invalidateNetworkScope();
    await admin.from('company_audit_log').insert({
      company_id: companyId,
      actor_id: actorId,
      action: 'network_configured',
      detail: patch,
    });
    return { ok: true };
  }

  /** Ulash uchun nomzodlar — boshqa (mustaqil) klinikalar */
  async candidates(companyId: string, q?: string) {
    const admin = this.supabase.admin();
    let query = admin
      .from('clinics')
      .select('id, name, slug, city, company_id, current_plan, subscription_status')
      .is('deleted_at', null)
      .neq('company_id', companyId)
      .order('name')
      .limit(50);
    const term = (q ?? '').replace(/[%_,()]/g, '').trim();
    if (term) query = query.or(`name.ilike.%${term}%,slug.ilike.%${term}%`);
    const { data } = await query;
    const rows = (data ?? []) as Array<{ id: string; company_id: string | null }>;
    // O'z filiallari bor klinika (boshqa tarmoq HQ'si) to'g'ridan ulanmaydi
    const companyIds = [...new Set(rows.map((r) => r.company_id).filter(Boolean))] as string[];
    const sizes = new Map<string, number>();
    if (companyIds.length) {
      const { data: sib } = await admin
        .from('clinics')
        .select('company_id')
        .in('company_id', companyIds)
        .is('deleted_at', null);
      for (const s of (sib ?? []) as Array<{ company_id: string }>) {
        sizes.set(s.company_id, (sizes.get(s.company_id) ?? 0) + 1);
      }
    }
    return rows.map((r) => ({
      ...r,
      own_network_size: r.company_id ? (sizes.get(r.company_id) ?? 1) : 1,
    }));
  }

  async preview(companyId: string, clinicId: string) {
    const { data, error } = await this.supabase
      .admin()
      .rpc('admin_network_preview' as never, { p_company: companyId, p_clinic: clinicId } as never);
    if (error) this.rpcError(error);
    return data;
  }

  async link(companyId: string, clinicId: string, actorId: string | null) {
    const { data, error } = await this.supabase
      .admin()
      .rpc(
        'admin_network_link_branch' as never,
        { p_company: companyId, p_clinic: clinicId, p_actor: actorId } as never,
      );
    if (error) this.rpcError(error);
    invalidateNetworkScope();
    return data;
  }

  async unlink(companyId: string, clinicId: string, actorId: string | null) {
    await this.assertClinicInCompany(companyId, clinicId);
    const { data, error } = await this.supabase
      .admin()
      .rpc(
        'admin_network_unlink_branch' as never,
        { p_clinic: clinicId, p_actor: actorId } as never,
      );
    if (error) this.rpcError(error);
    invalidateNetworkScope();
    return data;
  }

  async setHq(companyId: string, clinicId: string, actorId: string | null) {
    const { data, error } = await this.supabase
      .admin()
      .rpc(
        'admin_network_set_hq' as never,
        { p_company: companyId, p_clinic: clinicId, p_actor: actorId } as never,
      );
    if (error) this.rpcError(error);
    return data;
  }

  private async assertClinicInCompany(companyId: string, clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('clinics')
      .select('id')
      .eq('id', clinicId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (!data) throw new BadRequestException('Klinika shu tarmoqda emas');
  }

  /** Noldan yangi filial: HQ sozlamalari/tarifi bilan, katalog HQ'dan */
  async createBranch(
    companyId: string,
    input: z.infer<typeof NewBranchInput>,
    actorId: string | null,
  ) {
    const admin = this.supabase.admin();
    const { data: hqRaw } = await admin
      .from('clinics')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_hq', true)
      .is('deleted_at', null)
      .maybeSingle();
    const hq = hqRaw as (Record<string, unknown> & { id: string }) | null;
    if (!hq) throw new BadRequestException('Tarmoqda asosiy filial (HQ) yo‘q');

    const [{ data: company }, { count: live }, { data: slugTaken }] = await Promise.all([
      admin.from('companies').select('max_branches').eq('id', companyId).maybeSingle(),
      admin
        .from('clinics')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .is('deleted_at', null),
      admin.from('clinics').select('id').eq('slug', input.slug).maybeSingle(),
    ]);
    const max = (company as { max_branches: number } | null)?.max_branches ?? 1;
    if ((live ?? 0) >= max) {
      throw new BadRequestException(
        `Tarmoq limiti to'lgan (${live}/${max}) — avval limitni oshiring`,
      );
    }
    if (slugTaken) throw new BadRequestException('Bu slug allaqachon band');

    // Menejer (ixtiyoriy) — filialning o'z admini
    let managerId: string | null = null;
    if (input.manager_email) {
      const { data: created, error: userErr } = await admin.auth.admin.createUser({
        email: input.manager_email,
        email_confirm: true,
        user_metadata: { full_name: input.manager_full_name ?? input.name },
      });
      if (userErr) {
        throw new BadRequestException(
          /already|exist|registered/i.test(userErr.message)
            ? 'Bu email allaqachon ro‘yxatdan o‘tgan — filial ochilgach uni tarmoq a’zosi qilib qo‘shing'
            : userErr.message,
        );
      }
      managerId = created.user.id;
    }

    const copy = input.copy_settings;
    const { data: clinic, error: clinicErr } = await admin
      .from('clinics')
      .insert({
        slug: input.slug,
        name: input.name,
        city: input.city ?? null,
        country: hq.country ?? 'UZ',
        timezone: hq.timezone ?? 'Asia/Tashkent',
        default_locale: hq.default_locale ?? 'uz-Latn',
        currency: hq.currency ?? 'UZS',
        organization_type: hq.organization_type ?? 'clinic',
        primary_color: hq.primary_color ?? '#2563EB',
        logo_url: copy ? (hq.logo_url ?? null) : null,
        ...(copy
          ? { receipt_settings: hq.receipt_settings, document_settings: hq.document_settings }
          : {}),
        current_plan: hq.current_plan,
        subscription_status: hq.subscription_status,
        trial_ends_at: hq.trial_ends_at ?? null,
        subscription_ends_at: hq.subscription_ends_at ?? null,
        journal_pin_hash: DEFAULT_JOURNAL_PIN_HASH,
        journal_pin_set_at: new Date().toISOString(),
        company_id: companyId,
        is_hq: false,
        branch_code: input.branch_code || input.slug,
      })
      .select('id, name, slug')
      .single();
    if (clinicErr) {
      if (managerId) await admin.auth.admin.deleteUser(managerId).catch(() => undefined);
      throw new BadRequestException(clinicErr.message);
    }
    const newId = (clinic as { id: string }).id;

    if (managerId) {
      const { error: setErr } = await admin.rpc(
        'set_user_clinic' as never,
        { p_user_id: managerId, p_clinic_id: newId, p_role: 'clinic_admin' } as never,
      );
      if (setErr) throw new BadRequestException(setErr.message);
    }

    // Kim nomidan yaratiladi (created_by NOT NULL): menejer → tarmoq egasi → HQ admini
    const actorProfile = managerId ?? (await this.networkActorProfile(companyId, hq.id));

    if (actorProfile) {
      await admin.from('expense_categories').insert(
        DEFAULT_EXPENSE_CATEGORIES.map((c) => ({
          clinic_id: newId,
          name_i18n: c.name_i18n,
          sort_order: c.sort_order,
          created_by: actorProfile,
        })),
      );
    }

    let catalog: unknown = null;
    if (input.copy_catalog && actorProfile) {
      const { data, error } = await admin.rpc(
        'network_push_catalog' as never,
        {
          p_source: hq.id,
          p_targets: [newId],
          p_actor: actorProfile,
          p_kinds: ['services', 'lab', 'diagnostics'],
          p_update_prices: true,
        } as never,
      );
      if (error) catalog = { error: error.message };
      else catalog = data;
    }

    let magicLink: string | null = null;
    if (input.manager_email) {
      const origin = process.env.APP_URL ?? 'https://app.clary.uz';
      const { data: linkData } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: input.manager_email,
        options: { redirectTo: `${origin}/` },
      });
      magicLink = linkData?.properties?.action_link ?? null;
    }

    await admin.from('company_audit_log').insert({
      company_id: companyId,
      clinic_id: newId,
      actor_id: actorId,
      action: 'branch_created',
      detail: { name: input.name, slug: input.slug, manager: input.manager_email ?? null },
    });
    invalidateNetworkScope();
    return { clinic, catalog, manager_user_id: managerId, magic_link: magicLink };
  }

  private async networkActorProfile(companyId: string, hqId: string): Promise<string | null> {
    const admin = this.supabase.admin();
    const { data: owner } = await admin
      .from('company_members')
      .select('user_id')
      .eq('company_id', companyId)
      .eq('role', 'company_owner')
      .limit(1)
      .maybeSingle();
    if (owner) return (owner as { user_id: string }).user_id;
    const { data: hqAdmin } = await admin
      .from('profiles')
      .select('id')
      .eq('clinic_id', hqId)
      .in('role', ['clinic_owner', 'clinic_admin'])
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    return (hqAdmin as { id: string } | null)?.id ?? null;
  }

  addMember(companyId: string, body: z.infer<typeof MemberInput>, actorId: string | null) {
    return this.network.upsertMember(companyId, actorId, body);
  }

  removeMember(companyId: string, memberId: string, actorId: string | null) {
    return this.network.deleteMember(companyId, memberId, actorId);
  }

  /** Eski "Batafsil → Filiallar" endpointlari uchun: klinikaning tarmog'i */
  async companyOfClinic(clinicId: string): Promise<string> {
    const { data } = await this.supabase
      .admin()
      .from('clinics')
      .select('company_id')
      .eq('id', clinicId)
      .maybeSingle();
    const id = (data as { company_id: string | null } | null)?.company_id;
    if (!id) throw new NotFoundException('Klinikaning tarmog‘i topilmadi');
    return id;
  }
}

@ApiTags('admin')
@Controller('admin/networks')
@UseGuards(SuperAdminGuard)
class AdminNetworkController {
  constructor(private readonly svc: AdminNetworkService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get('by-clinic/:clinicId')
  async byClinic(@Param('clinicId', ParseUUIDPipe) clinicId: string) {
    return { company_id: await this.svc.companyOfClinic(clinicId) };
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.detail(id);
  }

  @Patch(':id')
  configure(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.svc.configure(id, ConfigureInput.parse(body), u.userId ?? null);
  }

  @Get(':id/candidates')
  candidates(@Param('id', ParseUUIDPipe) id: string, @Query('q') q?: string) {
    return this.svc.candidates(id, q);
  }

  @Get(':id/preview')
  preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('clinic_id', ParseUUIDPipe) clinicId: string,
  ) {
    return this.svc.preview(id, clinicId);
  }

  @Post(':id/link')
  link(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.svc.link(id, ClinicRef.parse(body).clinic_id, u.userId ?? null);
  }

  @Post(':id/unlink')
  unlink(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.svc.unlink(id, ClinicRef.parse(body).clinic_id, u.userId ?? null);
  }

  @Post(':id/hq')
  setHq(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.svc.setHq(id, ClinicRef.parse(body).clinic_id, u.userId ?? null);
  }

  @Post(':id/branches')
  createBranch(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.svc.createBranch(id, NewBranchInput.parse(body), u.userId ?? null);
  }

  @Post(':id/members')
  addMember(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.svc.addMember(id, MemberInput.parse(body), u.userId ?? null);
  }

  @Delete(':id/members/:memberId')
  removeMember(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.svc.removeMember(id, memberId, u.userId ?? null);
  }
}

@Module({
  imports: [CompanyModule],
  controllers: [AdminNetworkController],
  providers: [AdminNetworkService, SupabaseService],
  exports: [AdminNetworkService],
})
export class AdminNetworkModule {}
