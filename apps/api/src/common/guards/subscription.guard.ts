import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { getContext } from '../context/request-context';
import { SupabaseService } from '../services/supabase.service';

@Injectable()
export class SubscriptionGuard implements CanActivate {
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
    if (
      url.includes('/subscription') ||
      url.includes('/auth/') ||
      url.includes('/health')
    ) {
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
}
