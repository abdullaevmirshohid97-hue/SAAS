import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Injectable,
  Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { SupabaseService } from '../../common/services/supabase.service';
import { TelegramReportsModule, TelegramReportsService } from '../telegram-reports/telegram-reports.module';

// =============================================================================
// DMED Integratsiya — Faza 0: Poydevor + Opt-in Onboarding
//
// Oqim: super-admin ma'lumot kiritadi → klinikaga so'rov (invited) →
//       klinika admini "Qo'shilish" bosadi → active.
// Super-admin "Darhol faollashtirish" bilan rozilikni o'tkazib yubora oladi.
// status != 'active' bo'lsa hech narsa DMED'ga oqmaydi (Faza 1+).
// =============================================================================

// ── DmedClient — mock-first interfeys ──────────────────────────────────────
export interface DmedClient {
  testConnection(opts: { clientId: string; secret: string; fhirBase: string }): Promise<{ ok: boolean; message?: string }>;
}

// MockDmedClient: real sandbox/spec kelguncha
class MockDmedClient implements DmedClient {
  async testConnection(_opts: { clientId: string; secret: string; fhirBase: string }) {
    return { ok: true, message: 'Mock: ulanish muvaffaqiyatli (sandbox rejimi)' };
  }
}

export const DMED_CLIENT = 'DMED_CLIENT';

// ── Input schemas ────────────────────────────────────────────────────────────
const SaveConnectionSchema = z.object({
  client_id:     z.string().min(1),
  secret:        z.string().optional(),   // bo'sh = o'zgartirma
  fhir_base_url: z.string().url(),
  facility_code: z.string().min(1),
  scopes:        z.array(z.string()).default([]),
});

// ── DmedService ──────────────────────────────────────────────────────────────
@Injectable()
export class DmedService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly telegram: TelegramReportsService,
  ) {}

  private sb() { return this.supabase.admin(); }

  private async audit(clinicId: string | null, action: string, actorId: string | null, detail?: Record<string, unknown>) {
    await this.sb().from('dmed_audit_log').insert({
      clinic_id: clinicId, action, actor_user_id: actorId, detail: detail ?? {},
    });
  }

  // ── Super-admin: holat ko'rish ──
  async get(clinicId: string) {
    const { data } = await this.sb()
      .from('dmed_connections')
      .select('id, status, client_id, fhir_base_url, facility_code, scopes, invited_at, accepted_at, declined_at, force_activated, last_sync_at, last_error, created_at, updated_at, secret_vault_id')
      .eq('clinic_id', clinicId)
      .maybeSingle();
    if (!data) return { status: 'not_configured', has_secret: false };
    const d = data as Record<string, unknown>;
    const { secret_vault_id, ...rest } = d;
    return { ...rest, has_secret: !!secret_vault_id };
  }

  // ── Super-admin: saqlash (upsert draft) ──
  async save(clinicId: string, actorId: string | null, input: z.infer<typeof SaveConnectionSchema>) {
    const sb = this.sb();
    let secretVaultId: string | undefined;

    if (input.secret) {
      // Mavjud secret_vault_id'ni birinchi olamiz (almashtirish uchun)
      const { data: existing } = await sb.from('dmed_connections')
        .select('secret_vault_id').eq('clinic_id', clinicId).maybeSingle();
      const ex = existing as { secret_vault_id: string | null } | null;

      // Supabase Vault orqali shifrlash
      const secretName = `dmed-${clinicId}-${Date.now()}`;
      const { data: vaultId, error: vErr } = await (sb as unknown as {
        rpc: (fn: string, args: unknown) => Promise<{ data: string; error: unknown }>
      }).rpc('create_secret', { new_secret: input.secret, new_name: secretName });
      if (vErr) throw new BadRequestException('Vault: sir saqlanmadi');
      secretVaultId = vaultId;

      // Eski vault yozuvini o'chirish (ixtiyoriy, xatoni hisobga olmaymiz)
      if (ex?.secret_vault_id) {
        await (sb as unknown as {
          rpc: (fn: string, args: unknown) => Promise<unknown>
        }).rpc('delete_secret', { secret_id: ex.secret_vault_id }).catch(() => undefined);
      }
    }

    const upsertData: Record<string, unknown> = {
      clinic_id: clinicId,
      client_id: input.client_id,
      fhir_base_url: input.fhir_base_url,
      facility_code: input.facility_code,
      scopes: input.scopes,
      updated_at: new Date().toISOString(),
    };
    if (secretVaultId) upsertData.secret_vault_id = secretVaultId;

    const { error } = await sb.from('dmed_connections')
      .upsert(upsertData, { onConflict: 'clinic_id' });
    if (error) throw new BadRequestException(error.message);
    await this.audit(clinicId, 'save', actorId);
    return { ok: true };
  }

  // ── Super-admin: so'rov yuborish ──
  async invite(clinicId: string, actorId: string | null) {
    const { data: conn } = await this.sb().from('dmed_connections')
      .select('status, client_id, fhir_base_url').eq('clinic_id', clinicId).maybeSingle();
    if (!conn) throw new NotFoundException('Avval DMED ma\'lumotlarini kiriting');
    const c = conn as { status: string; client_id: string | null; fhir_base_url: string | null };
    if (!c.client_id || !c.fhir_base_url) throw new BadRequestException('client_id va fhir_base_url majburiy');
    if (c.status === 'active') throw new BadRequestException('Allaqachon ulangan');

    await this.sb().from('dmed_connections').update({
      status: 'invited',
      invited_by: actorId,
      invited_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('clinic_id', clinicId);

    // Klinika egasiga Telegram xabari (best-effort)
    const { data: cl } = await this.sb().from('clinics').select('name').eq('id', clinicId).maybeSingle();
    const clName = (cl as { name?: string } | null)?.name ?? 'Klinika';
    const text = `🔗 <b>DMED integratsiya taklifi</b>\n${clName} klinikasiga DMED bilan ulanish uchun so'rov yuborildi.\nKlinika ilovasiga kirib tasdiqlang.`;
    await this.telegram.sendToOwners(clinicId, text).catch(() => undefined);

    await this.audit(clinicId, 'invite', actorId);
    return { ok: true };
  }

  // ── Super-admin: majburiy faollashtirish ──
  async forceActivate(clinicId: string, actorId: string | null) {
    const { data: conn } = await this.sb().from('dmed_connections')
      .select('status').eq('clinic_id', clinicId).maybeSingle();
    if (!conn) throw new NotFoundException('DMED konfiguratsiyasi topilmadi');
    if ((conn as { status: string }).status === 'active') throw new BadRequestException('Allaqachon faol');

    await this.sb().from('dmed_connections').update({
      status: 'active',
      accepted_by: actorId,
      accepted_at: new Date().toISOString(),
      force_activated: true,
      updated_at: new Date().toISOString(),
    }).eq('clinic_id', clinicId);

    await this.audit(clinicId, 'force_activate', actorId, { note: 'super-admin majburiy faollashtirdi' });
    return { ok: true };
  }

  // ── Super-admin: uzish ──
  async disconnect(clinicId: string, actorId: string | null) {
    await this.sb().from('dmed_connections').update({
      status: 'disabled',
      updated_at: new Date().toISOString(),
    }).eq('clinic_id', clinicId);
    await this.audit(clinicId, 'disconnect', actorId);
    return { ok: true };
  }

  // ── Super-admin: test (MockDmedClient) ──
  async test(clinicId: string) {
    const { data: conn } = await this.sb().from('dmed_connections')
      .select('client_id, fhir_base_url').eq('clinic_id', clinicId).maybeSingle();
    if (!conn) throw new NotFoundException('DMED konfiguratsiyasi topilmadi');
    const c = conn as { client_id: string | null; fhir_base_url: string | null };
    // Mock — haqiqiy so'rov yubormaymiz (Faza 1: HttpDmedClient)
    const mock = new MockDmedClient();
    return mock.testConnection({
      clientId: c.client_id ?? '',
      secret: '***',
      fhirBase: c.fhir_base_url ?? '',
    });
  }

  // ── Klinika admini: faol taklif ──
  async activeInvitation(clinicId: string) {
    const { data } = await this.sb().from('dmed_connections')
      .select('id, status, fhir_base_url, facility_code, invited_at')
      .eq('clinic_id', clinicId)
      .eq('status', 'invited')
      .maybeSingle();
    return data ?? null;
  }

  // ── Klinika admini: qabul qilish ──
  async accept(clinicId: string, userId: string) {
    const { data: conn } = await this.sb().from('dmed_connections')
      .select('status').eq('clinic_id', clinicId).maybeSingle();
    if (!conn || (conn as { status: string }).status !== 'invited') throw new BadRequestException('Faol taklif topilmadi');

    await this.sb().from('dmed_connections').update({
      status: 'active',
      accepted_by: userId,
      accepted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('clinic_id', clinicId);

    await this.audit(clinicId, 'accept', userId);
    return { ok: true };
  }

  // ── Klinika admini: rad etish ──
  async decline(clinicId: string, userId: string) {
    const { data: conn } = await this.sb().from('dmed_connections')
      .select('status').eq('clinic_id', clinicId).maybeSingle();
    if (!conn || (conn as { status: string }).status !== 'invited') throw new BadRequestException('Faol taklif topilmadi');

    await this.sb().from('dmed_connections').update({
      status: 'declined',
      declined_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('clinic_id', clinicId);

    await this.audit(clinicId, 'decline', userId);
    return { ok: true };
  }

  // ── Super-admin: audit log ──
  async auditLog(clinicId: string) {
    const { data } = await this.sb().from('dmed_audit_log')
      .select('id, action, actor_user_id, detail, created_at')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(50);
    return data ?? [];
  }
}

// ── Super-admin controller ───────────────────────────────────────────────────
@ApiTags('admin')
@Controller('admin')
@UseGuards(SuperAdminGuard)
class DmedAdminController {
  constructor(private readonly svc: DmedService) {}

  @Get('tenants/:id/dmed')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.svc.get(id); }

  @Put('tenants/:id/dmed')
  save(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) { return this.svc.save(id, u.userId, SaveConnectionSchema.parse(body)); }

  @Post('tenants/:id/dmed/invite')
  invite(@CurrentUser() u: { userId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.invite(id, u.userId);
  }

  @Post('tenants/:id/dmed/activate')
  activate(@CurrentUser() u: { userId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.forceActivate(id, u.userId);
  }

  @Post('tenants/:id/dmed/disconnect')
  disconnect(@CurrentUser() u: { userId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.disconnect(id, u.userId);
  }

  @Post('tenants/:id/dmed/test')
  test(@Param('id', ParseUUIDPipe) id: string) { return this.svc.test(id); }

  @Get('tenants/:id/dmed/audit')
  audit(@Param('id', ParseUUIDPipe) id: string) { return this.svc.auditLog(id); }
}

// ── Klinika admini controller ────────────────────────────────────────────────
@ApiTags('dmed')
@Controller({ path: 'dmed', version: '1' })
class DmedClinicController {
  constructor(private readonly svc: DmedService) {}

  @Get('invitation/active')
  @Roles('clinic_admin', 'clinic_owner')
  active(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) return null;
    return this.svc.activeInvitation(u.clinicId);
  }

  @Post('invitation/accept')
  @Roles('clinic_admin', 'clinic_owner')
  accept(@CurrentUser() u: { clinicId: string | null; userId: string | null }) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.accept(u.clinicId, u.userId);
  }

  @Post('invitation/decline')
  @Roles('clinic_admin', 'clinic_owner')
  decline(@CurrentUser() u: { clinicId: string | null; userId: string | null }) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.decline(u.clinicId, u.userId);
  }
}

// ── Module ───────────────────────────────────────────────────────────────────
@Module({
  imports: [TelegramReportsModule],
  controllers: [DmedAdminController, DmedClinicController],
  providers: [
    DmedService,
    SupabaseService,
    { provide: DMED_CLIENT, useClass: MockDmedClient },
  ],
  exports: [DmedService],
})
export class DmedModule {}
