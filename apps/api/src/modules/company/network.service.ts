import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

import { invalidateNetworkScope } from '../../common/network/network-scope';
import { SupabaseService } from '../../common/services/supabase.service';
import { NetworkAccessService, type CompanyUser } from './network-access.service';
import { toIdList } from './network.policy';

export const MemberInput = z.object({
  email: z.string().email(),
  role: z.enum(['company_owner', 'company_admin', 'branch_user']),
  accessible_clinic_ids: z.array(z.string().uuid()).max(10).default([]),
});
export const MemberPatch = z.object({
  role: z.enum(['company_owner', 'company_admin', 'branch_user']).optional(),
  accessible_clinic_ids: z.array(z.string().uuid()).max(10).optional(),
});
export const NetworkSettingsPatch = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  shared_patients: z.boolean().optional(),
});
export const BranchPatch = z.object({
  branch_code: z.string().trim().max(20).nullable().optional(),
  branch_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
});

function monthRange(from?: string, to?: string): { from: string; to: string } {
  if (from && to) return { from, to };
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: iso(start), to: iso(now) };
}

export function todayTashkent(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());
}

// =============================================================================
// Tarmoq markazi — CEO bir ekranda barcha filiallarni ko'radi va boshqaradi.
// =============================================================================
@Injectable()
export class NetworkService {
  private readonly liveCache = new Map<string, { at: number; rows: unknown[] }>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly access: NetworkAccessService,
  ) {}

  async my(u: CompanyUser) {
    if (!u.clinicId) throw new ForbiddenException();
    const admin = this.supabase.admin();
    const companyId = await this.access.companyOf(u.clinicId);
    const [{ data: company }, { data: branches }, viewer] = await Promise.all([
      admin
        .from('companies')
        .select(
          'id, name, package, base_currency, country, max_branches, billing_mode, shared_patients, branch_fee_uzs',
        )
        .eq('id', companyId)
        .maybeSingle(),
      admin
        .from('clinics')
        .select('id, name, branch_code, branch_color, is_hq, city, address, phone')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .order('is_hq', { ascending: false })
        .order('name'),
      this.access.viewer(u),
    ]);
    const list = (branches ?? []) as Array<{ id: string }>;
    return {
      company,
      branches: list,
      branch_count: list.length,
      active_clinic_id: u.clinicId,
      viewer: viewer
        ? {
            member_role: viewer.memberRole,
            can_manage: viewer.canManage,
            is_owner: viewer.isOwner,
            branch_ids: viewer.branchIds,
          }
        : null,
    };
  }

  /** GL bo'yicha konsolidatsiyalangan foyda/zarar (buxgalteriya) */
  async consolidated(u: CompanyUser, fromQ?: string, toQ?: string) {
    const v = await this.access.requireViewer(u);
    const { from, to } = monthRange(fromQ, toQ);
    const { data, error } = await this.supabase.admin().rpc('company_consolidated_activity', {
      p_company: v.companyId,
      p_from: from,
      p_to: to,
    });
    if (error) throw new BadRequestException(error.message);
    const rows = (
      (data ?? []) as Array<{
        clinic_id: string;
        clinic_name: string;
        type: string;
        debit: number;
        credit: number;
      }>
    ).filter((r) => v.branchIds.includes(r.clinic_id));

    const branchMap = new Map<
      string,
      { clinic_id: string; clinic_name: string; income: number; expense: number; profit: number }
    >();
    let income = 0;
    let expense = 0;
    for (const r of rows) {
      const b = branchMap.get(r.clinic_id) ?? {
        clinic_id: r.clinic_id,
        clinic_name: r.clinic_name,
        income: 0,
        expense: 0,
        profit: 0,
      };
      if (r.type === 'income') {
        const val = Number(r.credit) - Number(r.debit);
        b.income += val;
        income += val;
      } else if (r.type === 'expense') {
        const val = Number(r.debit) - Number(r.credit);
        b.expense += val;
        expense += val;
      }
      branchMap.set(r.clinic_id, b);
    }
    const branches = [...branchMap.values()]
      .map((b) => ({ ...b, profit: b.income - b.expense }))
      .sort((a, b) => b.profit - a.profit);
    return { from, to, branches, consolidated: { income, expense, profit: income - expense } };
  }

  /** Bugungi jonli holat — har filial bo'yicha */
  async live(u: CompanyUser, day?: string) {
    const v = await this.access.requireViewer(u);
    const d = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : todayTashkent();
    const key = `${v.branchIds.join(',')}|${d}`;
    const hit = this.liveCache.get(key);
    if (hit && Date.now() - hit.at < 20_000) return { day: d, branches: hit.rows };
    const { data, error } = await this.supabase
      .admin()
      .rpc('network_live_snapshot' as never, { p_clinics: v.branchIds, p_day: d } as never);
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as unknown[];
    this.liveCache.set(key, { at: Date.now(), rows });
    return { day: d, branches: rows };
  }

  /** Davr bo'yicha filiallarni solishtirish (kassa ma'lumoti bo'yicha) */
  async compare(u: CompanyUser, fromQ?: string, toQ?: string) {
    const v = await this.access.requireViewer(u);
    const { from, to } = monthRange(fromQ, toQ);
    const { data, error } = await this.supabase
      .admin()
      .rpc(
        'network_period_compare' as never,
        { p_clinics: v.branchIds, p_from: from, p_to: to } as never,
      );
    if (error) throw new BadRequestException(error.message);
    return { from, to, branches: data ?? [] };
  }

  /** Barcha filiallar xodimlari bitta ro'yxatda */
  async staff(u: CompanyUser) {
    const v = await this.access.requireViewer(u);
    const admin = this.supabase.admin();
    const [{ data: hr }, { data: logins }, { data: clinics }] = await Promise.all([
      admin
        .from('staff_profiles')
        .select(
          'id, clinic_id, profile_id, last_name, first_name, patronymic, phone, position, specialization, salary_type, is_active',
        )
        .in('clinic_id', v.branchIds),
      admin
        .from('profiles')
        .select('id, clinic_id, full_name, email, phone, role, is_active, last_sign_in_at')
        .in('clinic_id', v.branchIds)
        .is('deleted_at', null),
      admin.from('clinics').select('id, name').in('id', v.branchIds),
    ]);
    const clinicName = new Map(
      ((clinics ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
    );
    const loginById = new Map(
      (
        (logins ?? []) as Array<{
          id: string;
          clinic_id: string;
          full_name: string;
          email: string;
          phone: string | null;
          role: string;
          is_active: boolean;
          last_sign_in_at: string | null;
        }>
      ).map((p) => [p.id, p]),
    );
    const out: Array<Record<string, unknown>> = [];
    const seenLogins = new Set<string>();
    for (const s of (hr ?? []) as Array<{
      id: string;
      clinic_id: string;
      profile_id: string | null;
      last_name: string;
      first_name: string;
      patronymic: string | null;
      phone: string | null;
      position: string;
      specialization: string | null;
      salary_type: string;
      is_active: boolean;
    }>) {
      const login = s.profile_id ? loginById.get(s.profile_id) : undefined;
      if (login) seenLogins.add(login.id);
      out.push({
        key: `hr:${s.id}`,
        staff_id: s.id,
        clinic_id: s.clinic_id,
        clinic_name: clinicName.get(s.clinic_id) ?? '—',
        full_name: [s.last_name, s.first_name, s.patronymic].filter(Boolean).join(' '),
        position: s.position,
        specialization: s.specialization,
        phone: s.phone ?? login?.phone ?? null,
        email: login?.email ?? null,
        role: login?.role ?? null,
        has_login: !!login,
        last_sign_in_at: login?.last_sign_in_at ?? null,
        is_active: s.is_active && (login ? login.is_active : true),
      });
    }
    for (const p of loginById.values()) {
      if (seenLogins.has(p.id)) continue;
      out.push({
        key: `login:${p.id}`,
        staff_id: null,
        clinic_id: p.clinic_id,
        clinic_name: clinicName.get(p.clinic_id) ?? '—',
        full_name: p.full_name,
        position: null,
        specialization: null,
        phone: p.phone,
        email: p.email,
        role: p.role,
        has_login: true,
        last_sign_in_at: p.last_sign_in_at,
        is_active: p.is_active,
      });
    }
    out.sort(
      (a, b) =>
        String(a.clinic_name).localeCompare(String(b.clinic_name)) ||
        String(a.full_name).localeCompare(String(b.full_name)),
    );
    return out;
  }

  // ── A'zolar (tarmoq rahbariyati) ──────────────────────────────────────────
  async members(u: CompanyUser) {
    const v = await this.access.requireManager(u);
    return this.listMembers(v.companyId);
  }

  async listMembers(companyId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('company_members')
      .select(
        'id, role, accessible_clinic_ids, created_at, user:profiles!company_members_user_id_fkey(id, full_name, email, role, clinic_id)',
      )
      .eq('company_id', companyId)
      .order('created_at');
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Array<Record<string, unknown>>).map((m) => ({
      ...m,
      accessible_clinic_ids: toIdList(m.accessible_clinic_ids),
    }));
  }

  async addMember(u: CompanyUser, body: z.infer<typeof MemberInput>) {
    const v = await this.access.requireOwner(u);
    return this.upsertMember(v.companyId, u.userId, body);
  }

  async upsertMember(companyId: string, actorId: string | null, body: z.infer<typeof MemberInput>) {
    const admin = this.supabase.admin();
    const { data: profile } = await admin
      .from('profiles')
      .select('id, full_name, workspace')
      // ilike — katta-kichik harfsiz; "_" va "%" belgilarini maska deb olmasin
      .ilike(
        'email',
        body.email.trim().replace(/[\\%_]/g, (c) => `\\${c}`),
      )
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    const p = profile as { id: string; full_name: string; workspace: string } | null;
    if (!p) {
      throw new BadRequestException(
        'Bu email bilan foydalanuvchi topilmadi — avval uni biror filialga xodim sifatida qo‘shing',
      );
    }
    if (p.workspace === 'pharmacy') {
      throw new BadRequestException('Dorixona akkaunti tarmoq a’zosi bo‘la olmaydi');
    }
    const live = await this.access.liveBranchIds(companyId);
    const ids = body.accessible_clinic_ids.filter((id) => live.includes(id));
    const { error } = await admin.from('company_members').upsert(
      {
        company_id: companyId,
        user_id: p.id,
        role: body.role,
        accessible_clinic_ids: body.role === 'branch_user' ? ids : [],
      },
      { onConflict: 'company_id,user_id' },
    );
    if (error) throw new BadRequestException(error.message);
    await this.access.audit(companyId, null, actorId, 'member_upsert', {
      user_id: p.id,
      role: body.role,
      accessible_clinic_ids: ids,
    });
    return { ok: true, user_id: p.id, full_name: p.full_name };
  }

  async updateMember(u: CompanyUser, memberId: string, patch: z.infer<typeof MemberPatch>) {
    const v = await this.access.requireOwner(u);
    const admin = this.supabase.admin();
    const { data: cur } = await admin
      .from('company_members')
      .select('id, user_id, role')
      .eq('id', memberId)
      .eq('company_id', v.companyId)
      .maybeSingle();
    const m = cur as { id: string; user_id: string; role: string } | null;
    if (!m) throw new NotFoundException('A’zo topilmadi');
    if (m.role === 'company_owner' && patch.role && patch.role !== 'company_owner') {
      await this.assertNotLastOwner(v.companyId, m.id);
    }
    const update: Record<string, unknown> = {};
    if (patch.role) update.role = patch.role;
    if (patch.accessible_clinic_ids) {
      const live = await this.access.liveBranchIds(v.companyId);
      update.accessible_clinic_ids = patch.accessible_clinic_ids.filter((id) => live.includes(id));
    }
    if ((patch.role ?? m.role) !== 'branch_user') update.accessible_clinic_ids = [];
    const { error } = await admin.from('company_members').update(update).eq('id', memberId);
    if (error) throw new BadRequestException(error.message);
    await this.access.audit(v.companyId, null, u.userId, 'member_update', {
      member_id: memberId,
      ...update,
    });
    return { ok: true };
  }

  async removeMember(u: CompanyUser, memberId: string) {
    const v = await this.access.requireOwner(u);
    return this.deleteMember(v.companyId, memberId, u.userId);
  }

  async deleteMember(companyId: string, memberId: string, actorId: string | null) {
    const admin = this.supabase.admin();
    const { data: cur } = await admin
      .from('company_members')
      .select('id, user_id, role')
      .eq('id', memberId)
      .eq('company_id', companyId)
      .maybeSingle();
    const m = cur as { id: string; user_id: string; role: string } | null;
    if (!m) throw new NotFoundException('A’zo topilmadi');
    if (m.role === 'company_owner') await this.assertNotLastOwner(companyId, m.id);
    const { error } = await admin.from('company_members').delete().eq('id', memberId);
    if (error) throw new BadRequestException(error.message);
    await this.access.audit(companyId, null, actorId, 'member_remove', { user_id: m.user_id });
    return { ok: true };
  }

  private async assertNotLastOwner(companyId: string, memberId: string) {
    const { count } = await this.supabase
      .admin()
      .from('company_members')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('role', 'company_owner')
      .neq('id', memberId);
    if (!count) throw new BadRequestException('Tarmoqda kamida bitta ega qolishi kerak');
  }

  // ── Tarmoq sozlamalari va filial belgilari ───────────────────────────────
  async updateSettings(u: CompanyUser, patch: z.infer<typeof NetworkSettingsPatch>) {
    const v = await this.access.requireOwner(u);
    if (Object.keys(patch).length === 0)
      throw new BadRequestException("Hech narsa o'zgartirilmadi");
    const { error } = await this.supabase
      .admin()
      .from('companies')
      .update(patch)
      .eq('id', v.companyId);
    if (error) throw new BadRequestException(error.message);
    if (patch.shared_patients !== undefined) invalidateNetworkScope();
    await this.access.audit(v.companyId, null, u.userId, 'settings_update', patch);
    return { ok: true };
  }

  async updateBranch(u: CompanyUser, clinicId: string, patch: z.infer<typeof BranchPatch>) {
    const v = await this.access.requireManager(u);
    this.access.assertBranches(v, [clinicId]);
    if (Object.keys(patch).length === 0)
      throw new BadRequestException("Hech narsa o'zgartirilmadi");
    const { error } = await this.supabase.admin().from('clinics').update(patch).eq('id', clinicId);
    if (error) throw new BadRequestException(error.message);
    await this.access.audit(v.companyId, clinicId, u.userId, 'branch_update', patch);
    return { ok: true };
  }

  async auditLog(u: CompanyUser, limit = 100) {
    const v = await this.access.requireManager(u);
    const { data } = await this.supabase
      .admin()
      .from('company_audit_log')
      .select('id, clinic_id, actor_id, action, detail, created_at')
      .eq('company_id', v.companyId)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 300));
    return data ?? [];
  }
}
