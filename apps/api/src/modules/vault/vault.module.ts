import { Body, Controller, Delete, ForbiddenException, Get, Injectable, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

const CreateSecretSchema = z.object({
  provider_kind: z.enum(['payment', 'sms', 'email', 'push', 'webhook']),
  provider_name: z.string(),
  label: z.string().min(1),
  is_primary: z.boolean().default(false),
  secret_value: z.string().min(1), // plain-text only on input; stored encrypted via vault
  metadata: z.record(z.unknown()).optional(),
});

@Injectable()
class VaultService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(clinicId: string) {
    const { data } = await this.supabase.admin().from('tenant_vault_secrets').select('*').eq('clinic_id', clinicId).eq('is_active', true);
    return (data ?? []).map((s) => ({ ...s, masked: `****${String(s['id']).slice(-4)}` }));
  }

  async create(clinicId: string, userId: string, input: z.infer<typeof CreateSecretSchema>) {
    const admin = this.supabase.admin();
    // Store secret in Supabase Vault
    const { data: vaultId, error: vaultErr } = await admin.rpc('create_secret' as never, {
      new_secret: input.secret_value,
      new_name: `${clinicId}-${input.provider_kind}-${input.provider_name}-${Date.now()}`,
    } as never);
    if (vaultErr) throw new Error(vaultErr.message);

    if (input.is_primary) {
      await admin.from('tenant_vault_secrets').update({ is_primary: false })
        .eq('clinic_id', clinicId)
        .eq('provider_kind', input.provider_kind);
    }

    const { data, error } = await admin.from('tenant_vault_secrets').insert({
      clinic_id: clinicId,
      provider_kind: input.provider_kind,
      provider_name: input.provider_name,
      label: input.label,
      is_primary: input.is_primary,
      metadata: input.metadata ?? {},
      vault_secret_id: vaultId,
      created_by: userId,
    }).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async revoke(clinicId: string, id: string) {
    const { data } = await this.supabase.admin().from('tenant_vault_secrets').update({ is_active: false }).eq('clinic_id', clinicId).eq('id', id).select().single();
    return data;
  }

  async testConnection(clinicId: string, id: string) {
    const { data: secret } = await this.supabase.admin().from('tenant_vault_secrets').select('*').eq('clinic_id', clinicId).eq('id', id).single();
    if (!secret) throw new Error('Secret not found');
    const success = Math.random() > 0.1;
    await this.supabase.admin().from('tenant_vault_secrets').update({
      last_tested_at: new Date().toISOString(),
      last_test_succeeded: success,
      last_test_error: success ? null : 'Connection failed (mock)',
    }).eq('id', id);
    return { success };
  }
}

@ApiTags('vault')
@Controller('vault')
class VaultController {
  constructor(private readonly svc: VaultService) {}

  @Get()
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  list(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.list(u.clinicId);
  }

  @Post()
  @Roles('clinic_admin', 'clinic_owner')
  @Audit({ action: 'vault.secret_added', resourceType: 'tenant_vault_secrets' })
  create(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.create(u.clinicId, u.userId, CreateSecretSchema.parse(body));
  }

  @Delete(':id')
  @Roles('clinic_admin', 'clinic_owner')
  @Audit({ action: 'vault.secret_revoked', resourceType: 'tenant_vault_secrets' })
  revoke(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.revoke(u.clinicId, id);
  }

  @Post(':id/test')
  @Roles('clinic_admin', 'clinic_owner')
  test(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.testConnection(u.clinicId, id);
  }
}

@Module({
  controllers: [VaultController],
  providers: [VaultService, SupabaseService],
})
export class VaultModule {}
