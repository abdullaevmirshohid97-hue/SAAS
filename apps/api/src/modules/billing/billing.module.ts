import { Body, Controller, ForbiddenException, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

const TransactionSchema = z.object({
  patient_id: z.string().uuid().optional(),
  appointment_id: z.string().uuid().optional(),
  amount_uzs: z.number().int(),
  payment_method: z.enum(['cash', 'card', 'transfer', 'insurance', 'click', 'payme', 'uzum', 'kaspi', 'humo', 'uzcard', 'stripe']),
  kind: z.enum(['payment', 'refund', 'deposit', 'adjustment']).default('payment'),
  items: z.array(z.object({
    service_id: z.string().uuid().optional(),
    name: z.string(),
    price: z.number().int(),
    quantity: z.number().int().default(1),
  })).default([]),
});

@Injectable()
class BillingService {
  constructor(private readonly supabase: SupabaseService) {}

  async openShift(clinicId: string, userId: string, openingCash: number) {
    const { data } = await this.supabase.admin().from('shifts').insert({
      clinic_id: clinicId, user_id: userId, opening_cash_uzs: openingCash,
    }).select().single();
    return data;
  }

  async closeShift(clinicId: string, id: string, actualCash: number) {
    const { data } = await this.supabase.admin().from('shifts').update({
      closed_at: new Date().toISOString(), actual_cash_uzs: actualCash,
    }).eq('clinic_id', clinicId).eq('id', id).select().single();
    return data;
  }

  async createTransaction(clinicId: string, userId: string, shiftId: string | null, input: z.infer<typeof TransactionSchema>) {
    const admin = this.supabase.admin();
    const { data: trx, error } = await admin.from('transactions').insert({
      clinic_id: clinicId, cashier_id: userId, shift_id: shiftId,
      patient_id: input.patient_id, appointment_id: input.appointment_id,
      kind: input.kind, amount_uzs: input.amount_uzs, payment_method: input.payment_method,
    }).select().single();
    if (error) throw new Error(error.message);

    if (input.items.length > 0) {
      await admin.from('transaction_items').insert(input.items.map((it) => ({
        clinic_id: clinicId,
        transaction_id: trx.id,
        service_id: it.service_id,
        service_name_snapshot: it.name,
        service_price_snapshot: it.price,
        quantity: it.quantity,
        final_amount_uzs: it.price * it.quantity,
      })));
    }
    return trx;
  }

  async listTransactions(clinicId: string, from?: string, to?: string) {
    let q = this.supabase.admin().from('transactions').select('*, items:transaction_items(*)').eq('clinic_id', clinicId);
    if (from) q = q.gte('created_at', from);
    if (to) q = q.lte('created_at', to);
    const { data } = await q.order('created_at', { ascending: false }).limit(500);
    return data ?? [];
  }
}

@ApiTags('billing')
@Controller('billing')
class BillingController {
  constructor(private readonly svc: BillingService) {}

  @Post('shifts/open')
  @Audit({ action: 'shift.opened', resourceType: 'shifts' })
  openShift(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: { opening_cash_uzs: number }) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.openShift(u.clinicId, u.userId, body.opening_cash_uzs);
  }

  @Patch('shifts/:id/close')
  @Audit({ action: 'shift.closed', resourceType: 'shifts' })
  closeShift(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string, @Body() body: { actual_cash_uzs: number }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.closeShift(u.clinicId, id, body.actual_cash_uzs);
  }

  @Post('transactions')
  @Audit({ action: 'payment.received', resourceType: 'transactions' })
  create(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
    @Query('shift_id') shiftId?: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createTransaction(u.clinicId, u.userId, shiftId ?? null, TransactionSchema.parse(body));
  }

  @Get('transactions')
  list(@CurrentUser() u: { clinicId: string | null }, @Query('from') from?: string, @Query('to') to?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listTransactions(u.clinicId, from, to);
  }
}

@Module({
  controllers: [BillingController],
  providers: [BillingService, SupabaseService],
})
export class BillingModule {}
