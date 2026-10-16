import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { SupabaseService } from '../../common/services/supabase.service';
import { TelegramReportsService } from '../telegram-reports/telegram-reports.module';
import { formatNetworkDigest, type DigestRow } from './network.policy';
import { todayTashkent } from './network.service';

// =============================================================================
// Tarmoq kunlik hisoboti — 10 ta alohida xabar o'rniga HQ egasiga BITTA xabar:
// har filial tushumi, navbati, yangi bemorlari, qarz va seyf qoldig'i.
// Filiallarning o'z kunlik digest'lari (23:55) o'zgarishsiz qoladi.
// =============================================================================
@Injectable()
export class NetworkDigestService {
  private readonly log = new Logger(NetworkDigestService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly telegram: TelegramReportsService,
  ) {}

  @Cron('58 23 * * *', { timeZone: 'Asia/Tashkent' })
  async dailyNetworkDigest(): Promise<void> {
    const admin = this.supabase.admin();
    const { data: clinics, error } = await admin
      .from('clinics')
      .select('id, company_id, is_hq')
      .is('deleted_at', null)
      .not('company_id', 'is', null);
    if (error) {
      this.log.warn(`network digest: ${error.message}`);
      return;
    }
    const byCompany = new Map<string, { hq: string | null; ids: string[] }>();
    for (const c of (clinics ?? []) as Array<{ id: string; company_id: string; is_hq: boolean }>) {
      const g = byCompany.get(c.company_id) ?? { hq: null, ids: [] };
      g.ids.push(c.id);
      if (c.is_hq) g.hq = c.id;
      byCompany.set(c.company_id, g);
    }
    const day = todayTashkent();
    let sent = 0;
    for (const [companyId, g] of byCompany) {
      if (g.ids.length < 2 || !g.hq) continue; // bitta filial — oddiy digest yetarli
      try {
        await this.sendFor(companyId, g.hq, g.ids, day);
        sent += 1;
      } catch (e) {
        this.log.warn(`network digest failed (company ${companyId}): ${(e as Error).message}`);
      }
    }
    if (sent) this.log.log(`Tarmoq digesti: ${sent} tarmoq`);
  }

  async sendFor(companyId: string, hqClinicId: string, branchIds: string[], day: string) {
    const admin = this.supabase.admin();
    const [{ data: company }, { data: rows, error }] = await Promise.all([
      admin.from('companies').select('name').eq('id', companyId).maybeSingle(),
      admin.rpc('network_live_snapshot' as never, { p_clinics: branchIds, p_day: day } as never),
    ]);
    if (error) throw new Error(error.message);
    const text = formatNetworkDigest(
      (company as { name?: string } | null)?.name ?? 'Tarmoq',
      day,
      ((rows ?? []) as Array<Record<string, unknown>>).map(
        (r): DigestRow => ({
          name: String(r.name ?? '—'),
          is_hq: Boolean(r.is_hq),
          received_uzs: Number(r.received_uzs ?? 0),
          pharmacy_uzs: Number(r.pharmacy_uzs ?? 0),
          debt_uzs: Number(r.debt_uzs ?? 0),
          queue_total: Number(r.queue_total ?? 0),
          new_patients: Number(r.new_patients ?? 0),
          open_shifts: Number(r.open_shifts ?? 0),
          safe_uzs: Number(r.safe_uzs ?? 0),
        }),
      ),
    );
    await this.telegram.sendToOwners(hqClinicId, text);
  }
}
