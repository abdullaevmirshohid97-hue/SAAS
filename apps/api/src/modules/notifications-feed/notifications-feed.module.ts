import {
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// =============================================================================
// Notifications feed — har rol uchun in-app bildirishnoma markazi.
// notifications_inapp jadvalidan o'qiydi (recipient_id = user yoki NULL =
// klinika bo'ylab). Doctor moduli ham shu jadvalni ishlatadi — bu modul
// uni doctor route'idan ajratib, butun app uchun ochadi.
// =============================================================================

@Injectable()
export class NotificationsFeedService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(clinicId: string, userId: string, onlyUnread = false) {
    let q = this.supabase
      .admin()
      .from('notifications_inapp')
      .select('id, kind, severity, title, body, ref_resource, ref_id, is_read, created_at')
      .eq('clinic_id', clinicId)
      .or(`recipient_id.eq.${userId},recipient_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (onlyUnread) q = q.eq('is_read', false);
    const { data } = await q;
    return data ?? [];
  }

  async unreadCount(clinicId: string, userId: string) {
    const { count } = await this.supabase
      .admin()
      .from('notifications_inapp')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('is_read', false)
      .or(`recipient_id.eq.${userId},recipient_id.is.null`);
    return { unread: count ?? 0 };
  }

  async markRead(clinicId: string, userId: string, id: string | 'all') {
    const admin = this.supabase.admin();
    let q = admin
      .from('notifications_inapp')
      .update({ is_read: true })
      .eq('clinic_id', clinicId)
      .or(`recipient_id.eq.${userId},recipient_id.is.null`);
    if (id !== 'all') q = q.eq('id', id);
    await q;
    return { ok: true };
  }
}

@ApiTags('notifications')
@Controller('notifications')
class NotificationsFeedController {
  constructor(private readonly svc: NotificationsFeedService) {}

  @Get()
  list(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Query('unread') unread?: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.list(u.clinicId, u.userId, unread === 'true');
  }

  @Get('count')
  count(@CurrentUser() u: { clinicId: string | null; userId: string | null }) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.unreadCount(u.clinicId, u.userId);
  }

  @Post(':id/read')
  markRead(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id') id: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.markRead(u.clinicId, u.userId, id === 'all' ? 'all' : id);
  }
}

@Module({
  controllers: [NotificationsFeedController],
  providers: [NotificationsFeedService, SupabaseService],
  exports: [NotificationsFeedService],
})
export class NotificationsFeedModule {}
