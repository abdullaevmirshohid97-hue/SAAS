import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';
import {
  resolveViewer,
  toIdList,
  type MemberRole,
  type Membership,
  type NetworkViewer,
} from './network.policy';

export interface CompanyUser {
  userId: string | null;
  clinicId: string | null;
  role: string;
}

export interface MyBranch {
  clinic_id: string;
  name: string;
  branch_code: string | null;
  is_hq: boolean;
  city: string | null;
  branch_color: string | null;
  company_id: string;
  member_role: MemberRole | null;
  is_home: boolean;
}

// =============================================================================
// Filial tarmog'i — kirish huquqi va filial almashtirish.
// Kompaniya FAOL filialdan (JWT clinic_id) aniqlanadi; huquq company_members
// a'zoligidan. Almashtirish JWT'ni server tomonda o'zgartiradi (RPC), brauzer
// refreshSession qiladi — RLS, Realtime va API bir xil filialni ko'radi.
// =============================================================================
@Injectable()
export class NetworkAccessService {
  constructor(private readonly supabase: SupabaseService) {}

  async companyOf(clinicId: string): Promise<string> {
    const { data } = await this.supabase
      .admin()
      .from('clinics')
      .select('company_id')
      .eq('id', clinicId)
      .maybeSingle();
    const companyId = (data as { company_id: string | null } | null)?.company_id ?? null;
    if (!companyId) throw new BadRequestException('Klinika tarmoqqa (kompaniyaga) bog‘lanmagan');
    return companyId;
  }

  async liveBranchIds(companyId: string): Promise<string[]> {
    const { data } = await this.supabase
      .admin()
      .from('clinics')
      .select('id, is_hq, name')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('is_hq', { ascending: false })
      .order('name');
    return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  }

  async membership(companyId: string, userId: string): Promise<Membership | null> {
    const { data } = await this.supabase
      .admin()
      .from('company_members')
      .select('role, accessible_clinic_ids')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .maybeSingle();
    const row = data as { role: MemberRole; accessible_clinic_ids: unknown } | null;
    return row
      ? { role: row.role, accessible_clinic_ids: toIdList(row.accessible_clinic_ids) }
      : null;
  }

  /** Tarmoq markazini ko'rish huquqi bo'lmasa — null */
  async viewer(u: CompanyUser): Promise<NetworkViewer | null> {
    if (!u.clinicId || !u.userId) return null;
    const companyId = await this.companyOf(u.clinicId);
    const [membership, liveBranchIds] = await Promise.all([
      this.membership(companyId, u.userId),
      this.liveBranchIds(companyId),
    ]);
    return resolveViewer({
      companyId,
      activeClinicId: u.clinicId,
      jwtRole: u.role,
      membership,
      liveBranchIds,
    });
  }

  async requireViewer(u: CompanyUser): Promise<NetworkViewer> {
    const v = await this.viewer(u);
    if (!v) {
      throw new ForbiddenException('Tarmoq markazi faqat tarmoq rahbariyati uchun');
    }
    return v;
  }

  async requireManager(u: CompanyUser): Promise<NetworkViewer> {
    const v = await this.requireViewer(u);
    if (!v.canManage) throw new ForbiddenException('Bu amal tarmoq rahbariyati uchun');
    return v;
  }

  async requireOwner(u: CompanyUser): Promise<NetworkViewer> {
    const v = await this.requireViewer(u);
    if (!v.isOwner) throw new ForbiddenException('Bu amal faqat tarmoq egasi uchun');
    return v;
  }

  /** So'ralgan filiallar ko'rinish doirasida bo'lishi shart */
  assertBranches(v: NetworkViewer, ids: string[]): void {
    const bad = ids.filter((id) => !v.branchIds.includes(id));
    if (bad.length) throw new ForbiddenException('Filial tarmoq doirangizdan tashqarida');
  }

  /** Almashtirgich uchun: men kira oladigan filiallar */
  async myBranches(userId: string): Promise<MyBranch[]> {
    const { data, error } = await this.supabase
      .admin()
      .rpc('network_my_branches' as never, { p_user: userId } as never);
    if (error) {
      // Migratsiya hali qo'llanmagan bo'lsa — almashtirgich shunchaki ko'rinmaydi
      if (/network_my_branches|schema cache|does not exist/i.test(error.message)) return [];
      throw new BadRequestException(error.message);
    }
    return (data ?? []) as MyBranch[];
  }

  async switchBranch(userId: string, clinicId: string) {
    const { data, error } = await this.supabase
      .admin()
      .rpc('network_switch_branch' as never, { p_user: userId, p_clinic: clinicId } as never);
    if (error) {
      if (/huquq/i.test(error.message)) throw new ForbiddenException(error.message);
      throw new BadRequestException(error.message);
    }
    return data as { clinic_id: string; role: string; is_home: boolean };
  }

  async audit(
    companyId: string,
    clinicId: string | null,
    actorId: string | null,
    action: string,
    detail: Record<string, unknown> = {},
  ): Promise<void> {
    await this.supabase
      .admin()
      .from('company_audit_log')
      .insert({ company_id: companyId, clinic_id: clinicId, actor_id: actorId, action, detail })
      .then(undefined, () => undefined);
  }
}
