import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

import type { ClaryRequestContext } from '../context/request-context';

@Injectable()
export class SupabaseService {
  private readonly url = process.env.SUPABASE_URL ?? '';
  private readonly anonKey = process.env.SUPABASE_ANON_KEY ?? '';
  private readonly serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  private readonly adminClient: SupabaseClient;

  constructor() {
    this.adminClient = createClient(this.url, this.serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  /**
   * Returns a Supabase client scoped to the current user's JWT so that
   * Postgres RLS policies fire against clinic_id = get_my_clinic_id().
   * NEVER use the service-role client for tenant queries.
   */
  forUser(_ctx: ClaryRequestContext, jwt?: string): SupabaseClient {
    if (!jwt) {
      return createClient(this.url, this.anonKey);
    }
    return createClient(this.url, this.anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
  }

  /** Only for explicit admin code paths. */
  admin(): SupabaseClient {
    return this.adminClient;
  }
}
