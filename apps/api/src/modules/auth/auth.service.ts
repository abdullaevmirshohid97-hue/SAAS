import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';

@Injectable()
export class AuthService {
  constructor(private readonly supabase: SupabaseService) {}

  async me(user: { userId: string | null; clinicId: string | null; role: string }) {
    if (!user.userId) throw new ForbiddenException();
    const { data, error } = await this.supabase
      .admin()
      .from('profiles')
      .select('*, clinic:clinics(*)')
      .eq('id', user.userId)
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async onboardingStatus(clinicId: string | null) {
    if (!clinicId) {
      return {
        clinic: false,
        staff: false,
        service: false,
        queue: false,
        completedSteps: 0,
        totalSteps: 4,
      };
    }
    const admin = this.supabase.admin();
    const [staffRes, svcRes, queueRes] = await Promise.all([
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId),
      admin.from('services').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId),
      admin.from('queues').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId),
    ]);

    const status = {
      clinic: true,
      staff: (staffRes.count ?? 0) > 1, // more than just the owner
      service: (svcRes.count ?? 0) > 0,
      queue: (queueRes.count ?? 0) > 0,
    };
    const completedSteps = Object.values(status).filter(Boolean).length;
    return { ...status, completedSteps, totalSteps: 4 };
  }

  async slugAvailable(slug: string) {
    const { data } = await this.supabase.admin().from('clinics').select('id').eq('slug', slug).maybeSingle();
    return { available: !data };
  }

  async completeOnboarding(userId: string, input: {
    clinicName: string; slug: string; country: string; region?: string; city?: string;
    timezone: string; defaultLocale: string; organizationType: string;
    logoUrl?: string; primaryColor?: string;
  }) {
    const admin = this.supabase.admin();

    // 1. Create clinic
    const { data: clinic, error: clinicErr } = await admin
      .from('clinics')
      .insert({
        slug: input.slug,
        name: input.clinicName,
        country: input.country,
        region: input.region,
        city: input.city,
        timezone: input.timezone,
        default_locale: input.defaultLocale,
        organization_type: input.organizationType,
        logo_url: input.logoUrl,
        primary_color: input.primaryColor ?? '#2563EB',
        current_plan: 'demo',
        subscription_status: 'trialing',
        trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();
    if (clinicErr) throw new BadRequestException(clinicErr.message);

    // 2. Attach user as clinic_admin + set JWT claims
    const { error: setErr } = await admin.rpc('set_user_clinic' as never, {
      p_user_id: userId,
      p_clinic_id: clinic.id,
      p_role: 'clinic_admin',
    } as never);
    if (setErr) throw new BadRequestException(setErr.message);

    // 3. Seed default templates by organization type (done via SQL function; stub here)
    return { clinic };
  }
}
