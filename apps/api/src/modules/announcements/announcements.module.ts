import { Controller, ForbiddenException, Get, Injectable, Module, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// =============================================================================
// Klinika e'lonlari — super-admin yuborgan bloklovchi xabarlar. Joriy foydalanuvchi
// ACK qilmagan faol e'lonlar; X bosilganda ack (per-user). Barcha klinika xodimi ko'radi.
// =============================================================================
@Injectable()
export class AnnouncementsService {
  constructor(private readonly supabase: SupabaseService) {}

  async active(clinicId: string, userId: string) {
    const { data } = await this.supabase
      .admin()
      .from('clinic_announcements')
      .select('id, title, body, plan_snapshot, amount_uzs, pay_date, contact_phone, requires_ack, created_at, acks:clinic_announcement_acks(user_id)')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    return ((data ?? []) as Array<Record<string, unknown> & { acks: Array<{ user_id: string }> }>)
      .filter((a) => !(a.acks ?? []).some((k) => k.user_id === userId))
      .map(({ acks, ...rest }) => rest);
  }

  async ack(clinicId: string, userId: string, id: string) {
    const admin = this.supabase.admin();
    // e'lon shu klinikaga tegishliligini tekshirish
    const { data: a } = await admin.from('clinic_announcements').select('id').eq('id', id).eq('clinic_id', clinicId).maybeSingle();
    if (!a) throw new ForbiddenException();
    await admin.from('clinic_announcement_acks').upsert({ announcement_id: id, user_id: userId }, { onConflict: 'announcement_id,user_id' });
    return { ok: true };
  }
}

@ApiTags('announcements')
@Controller({ path: 'announcements', version: '1' })
class AnnouncementsController {
  constructor(private readonly svc: AnnouncementsService) {}

  @Get('active')
  active(@CurrentUser() u: { clinicId: string | null; userId: string | null }) {
    if (!u.clinicId || !u.userId) return [];
    return this.svc.active(u.clinicId, u.userId);
  }

  @Post(':id/ack')
  ack(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Param('id') id: string) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.ack(u.clinicId, u.userId, id);
  }
}

@Module({
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService, SupabaseService],
})
export class AnnouncementsModule {}
