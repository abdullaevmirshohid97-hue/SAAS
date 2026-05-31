import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// Bo'lim -> jadvallar (counts preview uchun). Purge/restore mantiq DB RPC'da.
const SECTION_TABLES: Record<string, string[]> = {
  journal: ['transactions', 'pharmacy_sales', 'expenses'],
  cashier: ['transactions', 'expenses', 'safe_deposits'],
  inpatient: ['inpatient_stays', 'patient_ledger'],
  payroll: ['doctor_commissions', 'doctor_ledger', 'doctor_payouts'],
};

const PurgeSchema = z.object({
  section: z.enum(['journal', 'cashier', 'inpatient', 'payroll']),
  from: z.string(),
  to: z.string(),
  pin: z.string().regex(/^\d{4,8}$/),
  confirm: z.literal('DELETE'),
});

const RestoreSchema = z.object({
  batch_id: z.string().uuid(),
  pin: z.string().regex(/^\d{4,8}$/),
});

@Injectable()
class DataAdminService {
  constructor(private readonly supabase: SupabaseService) {}

  // Klinika jurnal PIN'ini tekshirish (owner himoyasi)
  private async verifyPin(clinicId: string, pin: string) {
    const { data } = await this.supabase
      .admin()
      .from('clinics')
      .select('journal_pin_hash')
      .eq('id', clinicId)
      .single();
    if (!data?.journal_pin_hash) throw new ForbiddenException('PIN o\'rnatilmagan (Jurnal PIN sozlang).');
    if ((data.journal_pin_hash as string) !== sha256(pin)) {
      throw new UnauthorizedException('Noto\'g\'ri PIN');
    }
  }

  private rangeIso(from: string, to: string) {
    // YYYY-MM-DD yoki ISO — kun chegaralariga keltiramiz
    const fromIso = from.length <= 10 ? `${from}T00:00:00Z` : from;
    const toIso = to.length <= 10 ? `${to}T23:59:59Z` : to;
    return { fromIso, toIso };
  }

  // Preview — har jadvalda nechta yozuv o'chadi (PIN'siz, faqat o'qish)
  async counts(clinicId: string, section: string, from: string, to: string) {
    const tables = SECTION_TABLES[section];
    if (!tables) throw new BadRequestException('Nomaʼlum bo\'lim');
    const { fromIso, toIso } = this.rangeIso(from, to);
    const admin = this.supabase.admin();
    const out: Array<{ table: string; count: number }> = [];
    for (const t of tables) {
      const { count } = await admin
        .from(t)
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .gte('created_at', fromIso)
        .lte('created_at', toIso);
      out.push({ table: t, count: count ?? 0 });
    }
    return { section, tables: out, total: out.reduce((a, r) => a + r.count, 0) };
  }

  async purge(
    clinicId: string,
    userId: string,
    input: z.infer<typeof PurgeSchema>,
  ) {
    await this.verifyPin(clinicId, input.pin);
    const { fromIso, toIso } = this.rangeIso(input.from, input.to);
    const { data, error } = await this.supabase.admin().rpc('data_admin_purge', {
      p_clinic_id: clinicId,
      p_section: input.section,
      p_from: fromIso,
      p_to: toIso,
      p_deleted_by: userId,
    });
    if (error) throw new BadRequestException(error.message);
    const batchId = data as unknown as string;
    // O'chirilgan yozuvlar sonini arxivdan hisoblaymiz
    const { count } = await this.supabase
      .admin()
      .from('deleted_records_archive')
      .select('id', { count: 'exact', head: true })
      .eq('batch_id', batchId);
    return { id: batchId, batch_id: batchId, deleted_count: count ?? 0 };
  }

  async batches(clinicId: string, limit: number) {
    const { data } = await this.supabase
      .admin()
      .from('deleted_records_archive')
      .select('batch_id, section, deleted_at, restored_at, deleted_by:profiles!deleted_records_archive_deleted_by_fkey(full_name)')
      .eq('clinic_id', clinicId)
      .order('deleted_at', { ascending: false });
    const rows = (data ?? []) as unknown as Array<{
      batch_id: string;
      section: string;
      deleted_at: string;
      restored_at: string | null;
      deleted_by: { full_name: string } | null;
    }>;
    // batch_id bo'yicha guruhlash
    const map = new Map<string, {
      batch_id: string;
      section: string;
      deleted_at: string;
      restored_at: string | null;
      deleted_by_name: string | null;
      record_count: number;
    }>();
    for (const r of rows) {
      const cur = map.get(r.batch_id);
      if (cur) {
        cur.record_count += 1;
      } else {
        map.set(r.batch_id, {
          batch_id: r.batch_id,
          section: r.section,
          deleted_at: r.deleted_at,
          restored_at: r.restored_at,
          deleted_by_name: r.deleted_by?.full_name ?? null,
          record_count: 1,
        });
      }
    }
    return [...map.values()].slice(0, limit);
  }

  async restore(clinicId: string, userId: string, input: z.infer<typeof RestoreSchema>) {
    await this.verifyPin(clinicId, input.pin);
    const { data, error } = await this.supabase.admin().rpc('data_admin_restore', {
      p_clinic_id: clinicId,
      p_batch_id: input.batch_id,
      p_restored_by: userId,
    });
    if (error) throw new BadRequestException(error.message);
    return { id: input.batch_id, restored_count: (data as unknown as number) ?? 0 };
  }
}

@ApiTags('data-admin')
@Controller({ path: 'data-admin', version: '1' })
class DataAdminController {
  constructor(private readonly svc: DataAdminService) {}

  @Get('counts')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  counts(
    @CurrentUser() u: { clinicId: string | null },
    @Query('section') section: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.counts(u.clinicId, section, from, to);
  }

  @Post('purge')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @Audit({ action: 'data_admin.purged', resourceType: 'deleted_records_archive' })
  purge(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.purge(u.clinicId, u.userId, PurgeSchema.parse(body));
  }

  @Get('batches')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  batches(
    @CurrentUser() u: { clinicId: string | null },
    @Query('limit') limit?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.batches(u.clinicId, limit ? Math.min(Number(limit), 200) : 50);
  }

  @Post('restore')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @Audit({ action: 'data_admin.restored', resourceType: 'deleted_records_archive' })
  restore(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.restore(u.clinicId, u.userId, RestoreSchema.parse(body));
  }
}

@Module({
  controllers: [DataAdminController],
  providers: [DataAdminService, SupabaseService],
})
export class DataAdminModule {}
