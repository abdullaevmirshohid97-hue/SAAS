import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { getContext, isPharmacyAccount } from '../context/request-context';
import { SupabaseService } from '../services/supabase.service';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  // Dorixona obunasi holati — har so'rovda bazaga bormaslik uchun qisqa kesh.
  private readonly pharmacySubCache = new Map<
    string,
    { at: number; active: boolean; deleted: boolean; suspended: boolean }
  >();

  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const c = getContext();
    if (!c.clinicId || c.role === 'super_admin') return true;

    // Obuna/to'lov bilan bog'liq endpoint'lar bloklanmaydi — aks holda
    // unpaid klinika to'lov ham qila olmay qoladi (deadlock).
    const req = ctx.switchToHttp().getRequest<{ url?: string }>();
    const url = req?.url ?? '';
    if (url.includes('/subscription') || url.includes('/auth/') || url.includes('/health')) {
      return true;
    }

    // Alohida "Dorixona" kirishi: klinika obunasidan MUSTAQIL — o'zining
    // dorixona obunasi (300 000 so'm) bo'yicha tekshiriladi. Holat endpointi
    // ochiq (aks holda "obuna faol emas" oynasini ham ko'rsatib bo'lmaydi).
    if (isPharmacyAccount(c)) {
      if (url.includes('/pharmacy-ws/status')) return true;
      const st = await this.pharmacyState(c.clinicId);
      if (st.deleted) throw new ForbiddenException('CLINIC_DELETED');
      if (st.suspended) throw new ForbiddenException('CLINIC_SUSPENDED');
      if (!st.active) {
        throw new ForbiddenException({
          error: 'PHARMACY_SUBSCRIPTION_INACTIVE',
          message: 'Dorixona obunasi faol emas',
        });
      }
      return true;
    }

    const { data: clinic } = await this.supabase
      .admin()
      .from('clinics')
      .select('subscription_status, is_suspended, trial_ends_at, deleted_at')
      .eq('id', c.clinicId)
      .single();

    if (!clinic) return true;

    // Arxivlangan (super-admin o'chirgan) klinika — barcha so'rovlar bloklanadi.
    // Frontend 403 ni ushlab, foydalanuvchini logout qiladi (sessiya yopiladi).
    if (clinic.deleted_at) {
      throw new ForbiddenException('CLINIC_DELETED');
    }

    // Mashina o'qiy oladigan kodlar — frontend SubscriptionGate shularni ushlab
    // to'liq ekranli tushunarli xabar ko'rsatadi ("ma'lumot yo'qoldi" vahimasi o'rniga).
    if (clinic.is_suspended) {
      throw new ForbiddenException('CLINIC_SUSPENDED');
    }

    if (['canceled', 'unpaid'].includes(clinic.subscription_status)) {
      throw new ForbiddenException('SUBSCRIPTION_INACTIVE');
    }

    if (
      clinic.subscription_status === 'trialing' &&
      clinic.trial_ends_at &&
      new Date(clinic.trial_ends_at) < new Date()
    ) {
      throw new ForbiddenException('TRIAL_EXPIRED');
    }

    return true;
  }

  private async pharmacyState(clinicId: string) {
    const hit = this.pharmacySubCache.get(clinicId);
    if (hit && Date.now() - hit.at < 30_000) return hit;
    const admin = this.supabase.admin();
    const [{ data: sub }, { data: clinic }] = await Promise.all([
      admin
        .from('product_subscriptions')
        .select('status, ends_at')
        .eq('clinic_id', clinicId)
        .eq('product', 'pharmacy')
        .maybeSingle(),
      admin.from('clinics').select('is_suspended, deleted_at').eq('id', clinicId).maybeSingle(),
    ]);
    const s = sub as { status: string; ends_at: string } | null;
    const cl = clinic as { is_suspended: boolean; deleted_at: string | null } | null;
    const v = {
      at: Date.now(),
      active: !!s && s.status === 'active' && new Date(s.ends_at).getTime() > Date.now(),
      deleted: !!cl?.deleted_at,
      suspended: !!cl?.is_suspended,
    };
    this.pharmacySubCache.set(clinicId, v);
    return v;
  }
}
