import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import * as argon2 from 'argon2';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { SupabaseService } from '../../common/services/supabase.service';

// =============================================================================
// Super admin — klinikaga alohida "Dorixona" biriktirish
// =============================================================================
// Oqim: klinikani tanlaydi → Gmail (dorixona akkaunti) + muddat → faollashadi.
// Tarif: 300 000 so'm/oy, 3 qurilma (o'zgartirish mumkin). Klinika obunasi va
// klinika ichidagi dorixona tabi O'ZGARMAYDI — bu alohida mahsulot.
// Faqat super admin faollashtiradi/uzaytiradi (AdminActionsInterceptor auditlaydi).
// =============================================================================

const DEFAULT_PRICE_UZS = 300_000;
const DEFAULT_MAX_DEVICES = 3;
// Ko'p oylik chegirma — klinika obunasidagi qoida bilan bir xil
const MONTH_DISCOUNT: Record<number, number> = { 1: 0, 3: 0.05, 6: 0.1, 12: 0.2 };

const AttachSchema = z.object({
  email: z.string().email(),
  full_name: z.string().max(100).optional(),
  password: z.string().min(8).max(100).optional(),
  months: z.number().int().min(1).max(36),
  price_uzs: z.number().int().nonnegative().optional(),
  max_devices: z.number().int().min(1).max(50).optional(),
  notes: z.string().max(500).optional(),
});
const ExtendSchema = z.object({
  months: z.number().int().min(1).max(36),
  notes: z.string().max(500).optional(),
});
const UpdateSchema = z.object({
  price_uzs: z.number().int().nonnegative().optional(),
  max_devices: z.number().int().min(1).max(50).optional(),
  notes: z.string().max(500).nullish(),
});
const ResetPinSchema = z.object({ pin: z.string().regex(/^\d{4,6}$/) });

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

type SubRow = {
  id: string;
  clinic_id: string;
  status: string;
  price_uzs: number;
  max_devices: number;
  starts_at: string;
  ends_at: string;
  account_user_id: string | null;
  account_email: string | null;
  notes: string | null;
};

@Injectable()
export class AdminPharmacyService {
  constructor(private readonly supabase: SupabaseService) {}

  private sb() {
    return this.supabase.admin();
  }

  private async sub(clinicId: string): Promise<SubRow | null> {
    const { data } = await this.sb()
      .from('product_subscriptions')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('product', 'pharmacy')
      .maybeSingle();
    return (data as SubRow | null) ?? null;
  }

  private async event(
    clinicId: string,
    adminId: string,
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    await this.sb()
      .from('product_subscription_events')
      .insert({ clinic_id: clinicId, product: 'pharmacy', action, created_by: adminId, ...extra })
      .then(undefined, () => undefined);
  }

  async list() {
    const { data, error } = await this.sb()
      .from('product_subscriptions')
      .select('*, clinic:clinics(id, name, slug, city)')
      .eq('product', 'pharmacy')
      .order('ends_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    const now = Date.now();
    return ((data ?? []) as Array<SubRow & { clinic: unknown }>).map((s) => ({
      ...s,
      active: s.status === 'active' && new Date(s.ends_at).getTime() > now,
      days_left: Math.max(0, Math.ceil((new Date(s.ends_at).getTime() - now) / 86_400_000)),
    }));
  }

  async get(clinicId: string) {
    const [sub, { data: clinic }, { data: devices }, { data: operators }, { data: events }] =
      await Promise.all([
        this.sub(clinicId),
        this.sb().from('clinics').select('id, name, slug').eq('id', clinicId).maybeSingle(),
        this.sb()
          .from('pharmacy_devices')
          .select('id, name, register_no, last_seen_at, is_revoked, created_at, user_agent')
          .eq('clinic_id', clinicId)
          .order('created_at', { ascending: true }),
        this.sb()
          .from('pharmacy_operators')
          .select('id, full_name, role, register_no, is_active, pin_locked_until')
          .eq('clinic_id', clinicId)
          .order('role'),
        this.sb()
          .from('product_subscription_events')
          .select('*')
          .eq('clinic_id', clinicId)
          .eq('product', 'pharmacy')
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
    if (!clinic) throw new NotFoundException('Klinika topilmadi');
    const now = Date.now();
    return {
      clinic,
      subscription: sub
        ? {
            ...sub,
            active: sub.status === 'active' && new Date(sub.ends_at).getTime() > now,
            days_left: Math.max(0, Math.ceil((new Date(sub.ends_at).getTime() - now) / 86_400_000)),
          }
        : null,
      devices: devices ?? [],
      operators: operators ?? [],
      events: events ?? [],
      defaults: { price_uzs: DEFAULT_PRICE_UZS, max_devices: DEFAULT_MAX_DEVICES },
    };
  }

  /**
   * Klinikaga dorixona biriktirish: dorixona akkaunti (Gmail) yaratiladi yoki
   * ulanadi, obuna `months` oyga faollashadi.
   */
  async attach(clinicId: string, adminId: string, input: z.infer<typeof AttachSchema>) {
    const admin = this.sb();
    const { data: clinic } = await admin
      .from('clinics')
      .select('id, deleted_at')
      .eq('id', clinicId)
      .maybeSingle();
    if (!clinic || (clinic as { deleted_at: string | null }).deleted_at) {
      throw new NotFoundException('Klinika topilmadi yoki arxivlangan');
    }
    const existingSub = await this.sub(clinicId);
    if (existingSub && existingSub.status !== 'canceled') {
      throw new BadRequestException('Bu klinikada dorixona allaqachon biriktirilgan — uzaytiring');
    }

    const email = input.email.trim().toLowerCase();
    const userId = await this.ensureAccount(clinicId, email, input.full_name);

    if (input.password) await this.applyPassword(userId, input.password);

    const { error: linkErr } = await admin.rpc(
      'pharmacy_link_account' as never,
      { p_user: userId, p_clinic: clinicId } as never,
    );
    if (linkErr) throw new BadRequestException(linkErr.message);

    const months = input.months;
    const price = input.price_uzs ?? DEFAULT_PRICE_UZS;
    const endsAt = new Date(Date.now() + months * 30 * 86_400_000).toISOString();
    const row = {
      clinic_id: clinicId,
      product: 'pharmacy',
      status: 'active',
      price_uzs: price,
      max_devices: input.max_devices ?? DEFAULT_MAX_DEVICES,
      starts_at: new Date().toISOString(),
      ends_at: endsAt,
      account_user_id: userId,
      account_email: email,
      notes: input.notes ?? null,
      activated_by: adminId,
      updated_at: new Date().toISOString(),
    };
    const { error } = existingSub
      ? await admin.from('product_subscriptions').update(row).eq('id', existingSub.id)
      : await admin.from('product_subscriptions').insert(row);
    if (error) throw new BadRequestException(error.message);

    const discount = MONTH_DISCOUNT[months] ?? 0;
    await this.event(clinicId, adminId, 'attach', {
      months,
      amount_uzs: Math.round(price * months * (1 - discount)),
      discount_pct: discount * 100,
      ends_at_after: endsAt,
      notes: `Akkaunt: ${email}`,
    });

    // Birinchi kirish uchun bir martalik havola (parolsiz)
    const origin = process.env.APP_URL ?? 'https://app.clary.uz';
    const { data: linkData } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${origin}/login?entry=pharmacy` },
    });
    return {
      ok: true,
      account_email: email,
      ends_at: endsAt,
      magic_link: linkData?.properties?.action_link ?? null,
    };
  }

  /** Dorixona akkaunti: yangi yaratadi yoki shu klinikadagi mavjud xodimni aylantiradi. */
  private async ensureAccount(clinicId: string, email: string, fullName?: string): Promise<string> {
    const admin = this.sb();
    const { data: prof } = await admin
      .from('profiles')
      .select('id, clinic_id, role, workspace')
      .ilike('email', email)
      .maybeSingle();
    const p = prof as {
      id: string;
      clinic_id: string | null;
      role: string;
      workspace: string;
    } | null;
    if (p) {
      // Qayta biriktirish (avval ham shu klinikaning dorixona akkaunti bo'lgan)
      // yoki hech qaysi klinikaga ulanmagan akkaunt — ishlatish mumkin.
      if (p.workspace === 'pharmacy' && (!p.clinic_id || p.clinic_id === clinicId)) return p.id;
      if (!p.clinic_id && p.role !== 'super_admin') return p.id;
      throw new BadRequestException(
        p.clinic_id === clinicId
          ? "Bu email klinika xodimining akkaunti. Kassir klinika ma'lumotlarini ko'rmasligi uchun dorixonaga ALOHIDA Gmail kiriting."
          : 'Bu email boshqa klinikaga ulangan — dorixona uchun boshqa Gmail kiriting',
      );
    }
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName ?? 'Dorixona' },
    });
    if (error || !created.user) {
      throw new BadRequestException(error?.message ?? 'Akkaunt yaratilmadi');
    }
    return created.user.id;
  }

  private async applyPassword(userId: string, password: string) {
    const admin = this.sb();
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (error) throw new BadRequestException(error.message);
    const { error: idErr } = await admin.rpc(
      'ensure_email_identity' as never,
      { p_user_id: userId } as never,
    );
    if (idErr) throw new BadRequestException(idErr.message);
  }

  async extend(clinicId: string, adminId: string, input: z.infer<typeof ExtendSchema>) {
    const sub = await this.sub(clinicId);
    if (!sub) throw new NotFoundException('Dorixona biriktirilmagan');
    const base = Math.max(Date.now(), new Date(sub.ends_at).getTime());
    const endsAt = new Date(base + input.months * 30 * 86_400_000).toISOString();
    const { error } = await this.sb()
      .from('product_subscriptions')
      .update({ ends_at: endsAt, status: 'active', updated_at: new Date().toISOString() })
      .eq('id', sub.id);
    if (error) throw new BadRequestException(error.message);
    const discount = MONTH_DISCOUNT[input.months] ?? 0;
    await this.event(clinicId, adminId, 'extend', {
      months: input.months,
      amount_uzs: Math.round(Number(sub.price_uzs) * input.months * (1 - discount)),
      discount_pct: discount * 100,
      ends_at_before: sub.ends_at,
      ends_at_after: endsAt,
      notes: input.notes ?? null,
    });
    return { ok: true, ends_at: endsAt };
  }

  async setStatus(clinicId: string, adminId: string, status: 'active' | 'suspended' | 'canceled') {
    const sub = await this.sub(clinicId);
    if (!sub) throw new NotFoundException('Dorixona biriktirilmagan');
    const { error } = await this.sb()
      .from('product_subscriptions')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', sub.id);
    if (error) throw new BadRequestException(error.message);
    if (status === 'canceled') {
      // Bekor qilinganda ochiq PIN sessiyalari yopiladi
      await this.sb()
        .from('pharmacy_operator_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('clinic_id', clinicId)
        .is('revoked_at', null);
    }
    await this.event(
      clinicId,
      adminId,
      status === 'active' ? 'resume' : status === 'suspended' ? 'suspend' : 'cancel',
    );
    return { ok: true, status };
  }

  async update(clinicId: string, adminId: string, input: z.infer<typeof UpdateSchema>) {
    const sub = await this.sub(clinicId);
    if (!sub) throw new NotFoundException('Dorixona biriktirilmagan');
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.price_uzs !== undefined) patch['price_uzs'] = input.price_uzs;
    if (input.max_devices !== undefined) patch['max_devices'] = input.max_devices;
    if (input.notes !== undefined) patch['notes'] = input.notes;
    const { error } = await this.sb().from('product_subscriptions').update(patch).eq('id', sub.id);
    if (error) throw new BadRequestException(error.message);
    await this.event(clinicId, adminId, 'update', { notes: JSON.stringify(input).slice(0, 400) });
    return { ok: true };
  }

  async revokeDevice(clinicId: string, adminId: string, deviceId: string) {
    const now = new Date().toISOString();
    const { error } = await this.sb()
      .from('pharmacy_devices')
      .update({ is_revoked: true, revoked_at: now, revoked_by: adminId })
      .eq('clinic_id', clinicId)
      .eq('id', deviceId);
    if (error) throw new BadRequestException(error.message);
    await this.sb()
      .from('pharmacy_operator_sessions')
      .update({ revoked_at: now })
      .eq('clinic_id', clinicId)
      .eq('device_id', deviceId)
      .is('revoked_at', null);
    await this.event(clinicId, adminId, 'device_revoke', { notes: deviceId });
    return { ok: true };
  }

  async restoreDevice(clinicId: string, adminId: string, deviceId: string) {
    const { error } = await this.sb()
      .from('pharmacy_devices')
      .update({ is_revoked: false, revoked_at: null, revoked_by: null })
      .eq('clinic_id', clinicId)
      .eq('id', deviceId);
    if (error) throw new BadRequestException(error.message);
    await this.event(clinicId, adminId, 'device_restore', { notes: deviceId });
    return { ok: true };
  }

  /**
   * Admin PIN unutilganda: birinchi faol adminning PIN'ini almashtiradi
   * (admin bo'lmasa — yangi "Admin" yaratadi) va blokni ochadi.
   */
  async resetAdminPin(clinicId: string, adminId: string, pin: string) {
    const admin = this.sb();
    const hash = await argon2.hash(pin, ARGON2_OPTIONS);
    const { data: op } = await admin
      .from('pharmacy_operators')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('role', 'admin')
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (op) {
      const { error } = await admin
        .from('pharmacy_operators')
        .update({ pin_hash: hash, pin_failed_attempts: 0, pin_locked_until: null })
        .eq('id', (op as { id: string }).id);
      if (error) throw new BadRequestException(error.message);
      await admin
        .from('pharmacy_operator_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('operator_id', (op as { id: string }).id)
        .is('revoked_at', null);
    } else {
      const { error } = await admin.from('pharmacy_operators').insert({
        clinic_id: clinicId,
        full_name: 'Admin',
        role: 'admin',
        pin_hash: hash,
        can_return: true,
        can_receive: true,
        can_discount: true,
      });
      if (error) throw new BadRequestException(error.message);
    }
    await this.event(clinicId, adminId, 'reset_pin');
    return { ok: true };
  }
}

@ApiTags('admin-pharmacy')
@Controller('admin')
@UseGuards(SuperAdminGuard)
class AdminPharmacyController {
  constructor(private readonly svc: AdminPharmacyService) {}

  @Get('pharmacy-subscriptions')
  list() {
    return this.svc.list();
  }

  @Get('tenants/:id/pharmacy')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(id);
  }

  @Post('tenants/:id/pharmacy/attach')
  attach(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() u: { userId: string | null },
    @Body() body: unknown,
  ) {
    return this.svc.attach(id, u.userId ?? '', AttachSchema.parse(body));
  }

  @Post('tenants/:id/pharmacy/extend')
  extend(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() u: { userId: string | null },
    @Body() body: unknown,
  ) {
    return this.svc.extend(id, u.userId ?? '', ExtendSchema.parse(body));
  }

  @Post('tenants/:id/pharmacy/suspend')
  suspend(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: { userId: string | null }) {
    return this.svc.setStatus(id, u.userId ?? '', 'suspended');
  }

  @Post('tenants/:id/pharmacy/resume')
  resume(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: { userId: string | null }) {
    return this.svc.setStatus(id, u.userId ?? '', 'active');
  }

  @Post('tenants/:id/pharmacy/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: { userId: string | null }) {
    return this.svc.setStatus(id, u.userId ?? '', 'canceled');
  }

  @Patch('tenants/:id/pharmacy')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() u: { userId: string | null },
    @Body() body: unknown,
  ) {
    return this.svc.update(id, u.userId ?? '', UpdateSchema.parse(body));
  }

  @Post('tenants/:id/pharmacy/devices/:deviceId/revoke')
  revokeDevice(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @CurrentUser() u: { userId: string | null },
  ) {
    return this.svc.revokeDevice(id, u.userId ?? '', deviceId);
  }

  @Post('tenants/:id/pharmacy/devices/:deviceId/restore')
  restoreDevice(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @CurrentUser() u: { userId: string | null },
  ) {
    return this.svc.restoreDevice(id, u.userId ?? '', deviceId);
  }

  @Post('tenants/:id/pharmacy/reset-admin-pin')
  resetAdminPin(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() u: { userId: string | null },
    @Body() body: unknown,
  ) {
    return this.svc.resetAdminPin(id, u.userId ?? '', ResetPinSchema.parse(body).pin);
  }
}

@Module({
  controllers: [AdminPharmacyController],
  providers: [AdminPharmacyService, SupabaseService],
})
export class AdminPharmacyModule {}
