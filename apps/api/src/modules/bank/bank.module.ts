import {
  Body, Controller, ForbiddenException, Get, Injectable, Module, Param, Post, Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// =============================================================================
// QISM 2 / E4 — Bank Integration: hisoblar + statement import + reconciliation.
// amount_uzs: +kirim / −chiqim. Avto-match: GL kassa (gl_code) bilan sana+summa.
// =============================================================================
const AccountSchema = z.object({
  name: z.string().min(1), bank_name: z.string().optional(),
  account_number: z.string().optional(), gl_code: z.string().optional(),
});
const ImportSchema = z.object({
  bank_account_id: z.string().uuid(),
  lines: z.array(z.object({
    txn_date: z.string(), amount_uzs: z.number().int(), description: z.string().optional(), external_ref: z.string().optional(),
  })).min(1),
});

@Injectable()
export class BankService {
  constructor(private readonly supabase: SupabaseService) {}

  async listAccounts(clinicId: string) {
    const { data } = await this.supabase.admin()
      .from('bank_accounts').select('*').eq('clinic_id', clinicId).eq('is_active', true).order('created_at');
    return data ?? [];
  }

  async createAccount(clinicId: string, body: z.infer<typeof AccountSchema>) {
    const { data, error } = await this.supabase.admin().from('bank_accounts')
      .insert({ clinic_id: clinicId, name: body.name, bank_name: body.bank_name ?? null, account_number: body.account_number ?? null, gl_code: body.gl_code ?? '1030' })
      .select('id').single();
    if (error) throw new Error(error.message);
    return { id: (data as { id: string }).id };
  }

  async listTransactions(clinicId: string, accountId: string) {
    const { data } = await this.supabase.admin()
      .from('bank_transactions').select('*')
      .eq('clinic_id', clinicId).eq('bank_account_id', accountId)
      .order('txn_date', { ascending: false }).limit(500);
    return data ?? [];
  }

  async importTransactions(clinicId: string, body: z.infer<typeof ImportSchema>) {
    const rows = body.lines.map((l) => ({
      clinic_id: clinicId, bank_account_id: body.bank_account_id,
      txn_date: l.txn_date, amount_uzs: l.amount_uzs, description: l.description ?? null, external_ref: l.external_ref ?? null,
    }));
    const { error } = await this.supabase.admin().from('bank_transactions').insert(rows);
    if (error) throw new Error(error.message);
    return { imported: rows.length };
  }

  async autoMatch(clinicId: string, accountId: string) {
    const { data, error } = await this.supabase.admin().rpc('bank_auto_match', { p_clinic: clinicId, p_account: accountId });
    if (error) throw new Error(error.message);
    return { matched: data as number };
  }

  async setStatus(clinicId: string, txnId: string, status: 'pending' | 'matched' | 'ignored', journalId?: string) {
    await this.supabase.admin().from('bank_transactions')
      .update({ status, matched_journal_id: status === 'matched' ? (journalId ?? null) : null })
      .eq('clinic_id', clinicId).eq('id', txnId);
    return { ok: true };
  }

  async reconciliation(clinicId: string, accountId: string) {
    const admin = this.supabase.admin();
    const { data: acc } = await admin.from('bank_accounts').select('gl_code').eq('id', accountId).maybeSingle();
    const glCode = (acc as { gl_code: string } | null)?.gl_code ?? '1030';
    const { data: txns } = await admin.from('bank_transactions').select('amount_uzs, status').eq('clinic_id', clinicId).eq('bank_account_id', accountId);
    const list = (txns ?? []) as Array<{ amount_uzs: number; status: string }>;
    const bank_balance = list.reduce((s, t) => s + Number(t.amount_uzs), 0);
    const pending = list.filter((t) => t.status === 'pending').length;
    // GL kassa balansi (gl_code) — kumulyativ
    const { data: gl } = await admin.rpc('gl_account_activity', { p_clinic: clinicId, p_from: '2000-01-01', p_to: new Date().toISOString().slice(0, 10) });
    const glRow = ((gl ?? []) as Array<{ code: string; debit: number; credit: number }>).find((r) => r.code === glCode);
    const gl_balance = glRow ? Number(glRow.debit) - Number(glRow.credit) : 0;
    return { gl_code: glCode, bank_balance, gl_balance, difference: bank_balance - gl_balance, pending_count: pending, total: list.length };
  }
}

@ApiTags('bank')
@Controller({ path: 'bank', version: '1' })
class BankController {
  constructor(private readonly svc: BankService) {}

  @Get('accounts')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  accounts(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listAccounts(u.clinicId);
  }

  @Post('accounts')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  createAccount(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.createAccount(u.clinicId, AccountSchema.parse(body));
  }

  @Get('accounts/:id/transactions')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  txns(@CurrentUser() u: { clinicId: string | null }, @Param('id') id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listTransactions(u.clinicId, id);
  }

  @Get('accounts/:id/reconciliation')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  recon(@CurrentUser() u: { clinicId: string | null }, @Param('id') id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.reconciliation(u.clinicId, id);
  }

  @Post('import')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  importTxns(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.importTransactions(u.clinicId, ImportSchema.parse(body));
  }

  @Post('accounts/:id/auto-match')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  match(@CurrentUser() u: { clinicId: string | null }, @Param('id') id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.autoMatch(u.clinicId, id);
  }

  @Post('transactions/:id/status')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  status(@CurrentUser() u: { clinicId: string | null }, @Param('id') id: string, @Body() body: { status: 'pending' | 'matched' | 'ignored'; journal_id?: string }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.setStatus(u.clinicId, id, body.status, body.journal_id);
  }
}

@Module({
  controllers: [BankController],
  providers: [BankService, SupabaseService],
})
export class BankModule {}
