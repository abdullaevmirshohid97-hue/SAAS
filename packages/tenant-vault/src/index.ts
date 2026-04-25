import type { SupabaseClient } from '@supabase/supabase-js';

export interface TenantSecret {
  id: string;
  clinic_id: string;
  provider_kind: 'payment' | 'sms' | 'email' | 'push' | 'webhook';
  provider_name: string;
  label: string;
  is_primary: boolean;
  metadata: Record<string, unknown>;
  value: string; // decrypted on fetch
}

export class TenantVault {
  constructor(private readonly admin: SupabaseClient) {}

  async resolve(clinicId: string, providerKind: TenantSecret['provider_kind'], primaryOnly = true): Promise<TenantSecret[]> {
    let q = this.admin
      .from('tenant_vault_secrets')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('provider_kind', providerKind)
      .eq('is_active', true);
    if (primaryOnly) q = q.eq('is_primary', true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const secrets: TenantSecret[] = [];
    for (const row of data ?? []) {
      const { data: vaultRow } = await this.admin.from('vault.decrypted_secrets' as never).select('decrypted_secret').eq('id', row['vault_secret_id']).single();
      secrets.push({
        id: row['id'] as string,
        clinic_id: row['clinic_id'] as string,
        provider_kind: row['provider_kind'] as TenantSecret['provider_kind'],
        provider_name: row['provider_name'] as string,
        label: row['label'] as string,
        is_primary: row['is_primary'] as boolean,
        metadata: (row['metadata'] as Record<string, unknown>) ?? {},
        value: (vaultRow as { decrypted_secret?: string } | null)?.decrypted_secret ?? '',
      });
    }
    return secrets;
  }
}
