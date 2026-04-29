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

    const { data: clinic } = await this.supabase
      .admin()
      .from('clinics')
      .select('subscription_status, is_suspended, trial_ends_at')
      .eq('id', c.clinicId)
      .single();

    if (!clinic) return true;

    if (clinic.is_suspended) {
      throw new ForbiddenException('Klinika to\'xtatilgan');
    }

    if (['canceled', 'unpaid'].includes(clinic.subscription_status)) {
      throw new ForbiddenException('Obuna faol emas');
    }

    if (
      clinic.subscription_status === 'trialing' &&
      clinic.trial_ends_at &&
      new Date(clinic.trial_ends_at) < new Date()
    ) {
      throw new ForbiddenException('Sinov muddati tugadi');
    }

    return true;
  }
}
