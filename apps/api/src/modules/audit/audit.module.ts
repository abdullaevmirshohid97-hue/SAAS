import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Injectable,
  Module,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

@Injectable()
class AuditService {
  constructor(private readonly supabase: SupabaseService) {}

  async activity(
    clinicId: string,
    opts: {
      from?: string;
      to?: string;
      actor?: string;
      action?: string;
      resource_type?: string;
      resource_id?: string;
      patient_id?: string;
      limit?: number;
    },
  ) {
    let q = this.supabase
      .admin()
      .from('activity_journal')
      .select('*, actor:profiles!actor_id(full_name, role)')
      .eq('clinic_id', clinicId);
    if (opts.from) q = q.gte('created_at', opts.from);
    if (opts.to) q = q.lte('created_at', opts.to);
    if (opts.actor) q = q.eq('actor_id', opts.actor);
    if (opts.action) q = q.ilike('action', `${opts.action}%`);
    if (opts.resource_type) q = q.eq('resource_type', opts.resource_type);
    if (opts.resource_id) q = q.eq('resource_id', opts.resource_id);
    if (opts.patient_id)
      q = q.or(
        `and(resource_type.eq.patients,resource_id.eq.${opts.patient_id}),metadata->>patient_id.eq.${opts.patient_id}`,
      );
    const { data } = await q.order('created_at', { ascending: false }).limit(opts.limit ?? 200);
    return data ?? [];
  }

  async activityCsv(clinicId: string, opts: Parameters<AuditService['activity']>[1]) {
    const rows = (await this.activity(clinicId, { ...opts, limit: 5000 })) as Array<{
      created_at: string;
      action: string;
      resource_type: string | null;
      resource_id: string | null;
      actor: { full_name: string; role: string } | null;
      summary_i18n: Record<string, string> | null;
    }>;
    const header = ['created_at', 'actor', 'role', 'action', 'resource_type', 'resource_id', 'summary'];
    const body = rows.map((r) =>
      [
        r.created_at,
        r.actor?.full_name ?? '',
        r.actor?.role ?? '',
        r.action,
        r.resource_type ?? '',
        r.resource_id ?? '',
        r.summary_i18n?.['uz-Latn'] ?? r.summary_i18n?.['en'] ?? '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    return [header.join(','), ...body].join('\n');
  }

  async settings(clinicId: string, opts: { table?: string; actor?: string; limit?: number }) {
    let q = this.supabase.admin().from('settings_audit_log').select('*').eq('clinic_id', clinicId);
    if (opts.table) q = q.eq('table_name', opts.table);
    if (opts.actor) q = q.eq('actor_id', opts.actor);
    const { data } = await q.order('sequence', { ascending: false }).limit(opts.limit ?? 200);
    return data ?? [];
  }

  async verifyChain(clinicId: string) {
    const { data } = await this.supabase.admin().rpc('verify_audit_chain' as never, { p_clinic_id: clinicId } as never);
    return data;
  }
}

@ApiTags('audit')
@Controller('audit')
class AuditController {
  constructor(private readonly svc: AuditService) {}

  @Get('activity')
  activity(
    @CurrentUser() u: { clinicId: string | null },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('actor') actor?: string,
    @Query('action') action?: string,
    @Query('resource_type') resourceType?: string,
    @Query('resource_id') resourceId?: string,
    @Query('patient_id') patientId?: string,
    @Query('limit') limit?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.activity(u.clinicId, {
      from,
      to,
      actor,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      patient_id: patientId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('activity.csv')
  @Header('Content-Type', 'text/csv')
  async activityCsv(
    @CurrentUser() u: { clinicId: string | null },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('actor') actor?: string,
    @Query('action') action?: string,
    @Query('patient_id') patientId?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.activityCsv(u.clinicId, { from, to, actor, action, patient_id: patientId });
  }

  @Get('settings')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  settings(
    @CurrentUser() u: { clinicId: string | null },
    @Query('table') table?: string,
    @Query('actor') actor?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.settings(u.clinicId, { table, actor });
  }

  @Get('settings/verify')
  @Roles('clinic_admin', 'super_admin')
  verify(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.verifyChain(u.clinicId);
  }
}

@Module({
  controllers: [AuditController],
  providers: [AuditService, SupabaseService],
})
export class AuditModule {}
