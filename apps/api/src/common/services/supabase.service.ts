import { BadRequestException, Injectable } from '@nestjs/common';
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

  /**
   * Klinikaning faol (ochiq) kassa smenasini topadi va uning ID'sini qaytaradi.
   * Smena ochilmagan bo'lsa BadRequestException — pul harakati (deposit,
   * kirim/chiqim, rasxot, checkout) faqat ochiq smena bilan amalga oshiriladi.
   */
  async requireActiveShift(clinicId: string): Promise<string> {
    const { data } = await this.adminClient
      .from('shifts')
      .select('id')
      .eq('clinic_id', clinicId)
      .is('closed_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) {
      throw new BadRequestException(
        'Kassa smenasi ochilmagan. Avval kassada smena oching, keyin pul amallarini bajaring.',
      );
    }
    return (data as { id: string }).id;
  }
}
