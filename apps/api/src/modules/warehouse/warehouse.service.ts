import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Client, Pool, type ClientConfig } from 'pg';
import { randomBytes } from 'node:crypto';

import { SupabaseService } from '../../common/services/supabase.service';
import { WAREHOUSE_INITIAL_SCHEMA, WAREHOUSE_SCHEMA_VERSION } from './warehouse-schema';
import {
  provisioningBackoffMs,
  provisioningFailureState,
  quotePostgresIdentifier,
  redactInfraError,
  warehouseDatabaseNames,
  warehouseHostname,
} from './warehouse-utils';

// =============================================================================
// CLARY Sklad — kompaniya (tenant) ro'yxati va alohida baza yaratish.
// =============================================================================
// Bu servis FAQAT Sklad API jarayonida (sklad-main.ts → SkladAppModule) ishlaydi.
// CLARY Clinic API'ga (app.module.ts) ulanmagan — Clinic guard'lari, obunasi va
// jarayoni Sklad'dan butunlay mustaqil.
//
// Navbat — BAZADA (Redis/BullMQ emas): `claim_warehouse_provisioning` RPC
// atomar ravishda bitta ishni oladi (SKIP LOCKED + lease). Shu sabab:
//   • ikki urinish bitta kompaniyani bir vaqtda yarata olmaydi;
//   • qo'lda "Qayta urinish" avto-urinish bilan poyga qilmaydi;
//   • jarayon qulasa — lease tugagach ish boshqa urinishga qaytadi.
// =============================================================================

type WarehouseTenant = {
  id: string;
  name: string;
  slug: string;
  status: string;
  owner_user_id: string;
  plan_code: string;
};

/** Ishchi bitta urinishga ajratadigan vaqt (s). Undan oshsa ish qayta olinadi. */
const LEASE_SECONDS = 600;
const SAFE_FAILURE = 'Baza yaratilmadi — server loglarini tekshiring (sabab bu yerga yozilmaydi).';

function sslConfig(): ClientConfig['ssl'] {
  return process.env.WAREHOUSE_DATABASE_SSLMODE === 'disable'
    ? false
    : { rejectUnauthorized: process.env.WAREHOUSE_DATABASE_REJECT_UNAUTHORIZED !== 'false' };
}

@Injectable()
export class WarehouseService implements OnModuleDestroy {
  private readonly log = new Logger('WarehouseService');
  private readonly tenantPools = new Map<string, Pool>();

  constructor(private readonly supabase: SupabaseService) {}

  private admin() {
    return this.supabase.admin();
  }

  // ---------------------------------------------------------------------------
  // Super Admin
  // ---------------------------------------------------------------------------
  async createTenant(
    input: { name: string; slug: string; owner_user_id: string; plan_code?: string },
    actorId: string,
  ) {
    const baseDomain = process.env.WAREHOUSE_BASE_DOMAIN ?? 'sklad.clary.uz';
    const hostname = warehouseHostname(input.slug, baseDomain);

    const { data: owner, error: ownerError } = await this.admin().auth.admin.getUserById(
      input.owner_user_id,
    );
    if (ownerError || !owner.user) throw new NotFoundException('CLARY identity user not found');

    const { data, error } = await this.admin().rpc('create_warehouse_tenant', {
      p_name: input.name.trim(),
      p_slug: input.slug,
      p_hostname: hostname,
      p_owner_user_id: input.owner_user_id,
      p_created_by: actorId,
      p_plan_code: input.plan_code ?? 'starter',
    });
    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        throw new ConflictException('Warehouse slug or hostname already exists');
      }
      throw new ServiceUnavailableException('Warehouse tenant registry could not be created');
    }
    // Navbatga yozildi (PENDING). Ishchi bir necha soniyada oladi.
    return { tenant_id: data as string, hostname, status: 'PENDING' };
  }

  /** Faqat FAILED kompaniya qayta navbatga qo'yiladi (urinishlar 0 dan). */
  async retryProvisioning(tenantId: string) {
    const { data: tenant, error } = await this.admin()
      .from('warehouse_tenants')
      .select('id,status')
      .eq('id', tenantId)
      .maybeSingle();
    if (error || !tenant) throw new NotFoundException('Warehouse tenant not found');
    if (tenant.status === 'ACTIVE')
      throw new ConflictException('Warehouse tenant is already active');
    if (tenant.status !== 'FAILED') {
      throw new ConflictException(
        'Kompaniya hozir navbatda yoki yaratilmoqda — qayta urinish faqat FAILED holatida',
      );
    }
    const now = new Date().toISOString();
    const { error: dbErr } = await this.admin()
      .from('warehouse_tenant_databases')
      .update({
        status: 'PENDING',
        attempts: 0,
        next_attempt_at: now,
        lease_expires_at: null,
        last_error: null,
        updated_at: now,
      })
      .eq('tenant_id', tenantId)
      .eq('status', 'FAILED');
    if (dbErr) throw new ServiceUnavailableException('Warehouse tenant status could not be reset');
    const { error: tErr } = await this.admin()
      .from('warehouse_tenants')
      .update({ status: 'PENDING', updated_at: now })
      .eq('id', tenantId)
      .eq('status', 'FAILED');
    if (tErr) throw new ServiceUnavailableException('Warehouse tenant status could not be reset');
    await this.logEvent(tenantId, 'database.retry', 'INFO', 'Qayta urinish navbatga qo‘yildi');
    return { tenant_id: tenantId, status: 'PENDING' };
  }

  async listTenants() {
    const { data, error } = await this.admin()
      .from('warehouse_tenants')
      .select(
        'id,name,slug,owner_user_id,plan_code,status,created_at,warehouse_tenant_domains(hostname),warehouse_tenant_databases(status,attempts,next_attempt_at,last_error,provisioned_at)',
      )
      .order('created_at', { ascending: false });
    if (error) throw new ServiceUnavailableException('Warehouse tenant registry unavailable');
    return data ?? [];
  }

  async getTenant(tenantId: string) {
    const { data, error } = await this.admin()
      .from('warehouse_tenants')
      .select(
        'id,name,slug,owner_user_id,plan_code,status,created_at,warehouse_tenant_domains(hostname),warehouse_tenant_databases(status,attempts,next_attempt_at,last_error,provisioned_at),warehouse_provisioning_events(event_type,status,message,created_at)',
      )
      .eq('id', tenantId)
      .maybeSingle();
    if (error) throw new ServiceUnavailableException('Warehouse tenant registry unavailable');
    if (!data) throw new NotFoundException('Warehouse tenant not found');
    return data;
  }

  // ---------------------------------------------------------------------------
  // Navbat ishchisi (WarehouseProvisioningWorker chaqiradi)
  // ---------------------------------------------------------------------------
  /** Bitta ishni olib bajaradi. Ish bo'lmasa — false. */
  async runNextProvisioningJob(): Promise<boolean> {
    const { data, error } = await this.admin().rpc('claim_warehouse_provisioning', {
      p_lease_seconds: LEASE_SECONDS,
    });
    if (error) {
      this.log.warn(`Navbatdan ish olinmadi: ${error.message}`);
      return false;
    }
    const job = (Array.isArray(data) ? data[0] : data) as
      | { tenant_id: string; attempts: number }
      | undefined;
    if (!job?.tenant_id) return false;

    await this.logEvent(job.tenant_id, 'database.provisioning', 'INFO', `Urinish #${job.attempts}`);
    try {
      await this.provisionTenant(job.tenant_id);
    } catch (e) {
      await this.recordFailure(job.tenant_id, job.attempts, e);
    }
    return true;
  }

  private async recordFailure(tenantId: string, attempt: number, error: unknown) {
    // To'liq sabab FAQAT server logida (ulanish satri/parol olib tashlangan) —
    // bazaga va Super Admin'ga umumiy xabar.
    this.log.error(`Sklad tenant ${tenantId} urinish #${attempt}: ${redactInfraError(error)}`);
    const next = provisioningFailureState(attempt);
    const now = Date.now();
    await this.admin()
      .from('warehouse_tenant_databases')
      .update({
        status: next,
        lease_expires_at: null,
        next_attempt_at: new Date(now + provisioningBackoffMs(attempt)).toISOString(),
        last_error: SAFE_FAILURE,
        updated_at: new Date(now).toISOString(),
      })
      .eq('tenant_id', tenantId);
    await this.admin()
      .from('warehouse_tenants')
      .update({ status: next, updated_at: new Date(now).toISOString() })
      .eq('id', tenantId);
    await this.logEvent(
      tenantId,
      'database.provisioning',
      next === 'FAILED' ? 'ERROR' : 'WARNING',
      next === 'FAILED'
        ? `Urinish #${attempt} — to‘xtatildi. Super Admin'dan "Qayta urinish".`
        : `Urinish #${attempt} xato — keyingisi ${Math.round(provisioningBackoffMs(attempt) / 1000)} s dan keyin`,
    );
  }

  /**
   * Kompaniya bazasini yaratadi (idempotent — har qadam qayta bajarilsa ham
   * xavfsiz). Advisory lock butun jarayon davomida (admin ulanishida) ushlanadi.
   */
  async provisionTenant(tenantId: string): Promise<void> {
    const adminUrl = process.env.WAREHOUSE_DATABASE_ADMIN_URL;
    if (!adminUrl) throw new Error('WAREHOUSE_DATABASE_ADMIN_URL is not configured');

    const { data: tenant, error: tenantError } = await this.admin()
      .from('warehouse_tenants')
      .select('id,name,slug,status,owner_user_id,plan_code')
      .eq('id', tenantId)
      .maybeSingle();
    if (tenantError || !tenant) throw new Error('Warehouse tenant not found');
    const t = tenant as WarehouseTenant;
    if (t.status === 'ACTIVE') return;

    const names = warehouseDatabaseNames(t.id);
    const password = randomBytes(32).toString('base64url');
    const lockKey = `clary-warehouse:${tenantId}`;
    const ssl = sslConfig();

    const control = new Client({
      connectionString: adminUrl,
      connectionTimeoutMillis: 10_000,
      ssl,
    });
    await control.connect();
    try {
      const lock = await control.query<{ ok: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS ok',
        [lockKey],
      );
      if (!lock.rows[0]?.ok) throw new Error('Tenant provisioning lock is held by another worker');

      try {
        // 1) Rol + baza (server darajasida)
        const role = quotePostgresIdentifier(names.databaseRole);
        const db = quotePostgresIdentifier(names.databaseName);
        const roleExists = await control.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [
          names.databaseRole,
        ]);
        // Parol lokal base64url (tirnoq/SQL belgisi yo'q).
        const verb = roleExists.rowCount === 0 ? 'CREATE ROLE' : 'ALTER ROLE';
        await control.query(`${verb} ${role} WITH LOGIN PASSWORD '${password}'`);
        const dbExists = await control.query('SELECT 1 FROM pg_database WHERE datname = $1', [
          names.databaseName,
        ]);
        if (dbExists.rowCount === 0) await control.query(`CREATE DATABASE ${db}`);
        // PUBLIC'ga standart CONNECT olib tashlanadi — bir tenant roli boshqasining
        // bazasiga ulana olmaydi (parol oqib ketsa ham).
        await control.query(`REVOKE CONNECT, TEMPORARY ON DATABASE ${db} FROM PUBLIC`);
        await control.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO ${role}`);

        // 2) Sxema huquqlari (baza ichida, provisioner nomidan)
        const dbAdminUrl = new URL(adminUrl);
        dbAdminUrl.pathname = `/${names.databaseName}`;
        const dbAdmin = new Client({
          connectionString: dbAdminUrl.toString(),
          connectionTimeoutMillis: 10_000,
          ssl,
        });
        await dbAdmin.connect();
        try {
          await dbAdmin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
          await dbAdmin.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${role}`);
        } finally {
          await dbAdmin.end().catch(() => undefined);
        }

        // 3) Data-plane sxemasi — tenant roli nomidan (jadvallar egasi = tenant)
        const tenantUrl = new URL(adminUrl);
        tenantUrl.pathname = `/${names.databaseName}`;
        tenantUrl.username = names.databaseRole;
        tenantUrl.password = password;
        const tenantClient = new Client({
          connectionString: tenantUrl.toString(),
          connectionTimeoutMillis: 10_000,
          ssl,
        });
        await tenantClient.connect();
        try {
          for (const statement of WAREHOUSE_INITIAL_SCHEMA) await tenantClient.query(statement);
          await tenantClient.query(
            'INSERT INTO warehouse_meta (singleton, tenant_id, schema_version) VALUES (TRUE, $1, $2) ' +
              'ON CONFLICT (singleton) DO UPDATE SET schema_version = EXCLUDED.schema_version',
            [tenantId, WAREHOUSE_SCHEMA_VERSION],
          );
          await tenantClient.query(
            'INSERT INTO warehouse_schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
            [WAREHOUSE_SCHEMA_VERSION],
          );
          await tenantClient.query(
            'INSERT INTO warehouse_users (user_id, role) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
            [t.owner_user_id, 'warehouse_owner'],
          );
        } finally {
          await tenantClient.end().catch(() => undefined);
        }

        // 4) Ulanish satri Vault'ga (UPSERT — yangi parol eski sirni almashtiradi)
        const { data: secretId, error: secretError } = await this.admin().rpc(
          'upsert_warehouse_db_secret',
          { p_secret: tenantUrl.toString(), p_name: `clary-warehouse-${tenantId}` },
        );
        if (secretError || !secretId) {
          throw new Error('Could not store warehouse database credentials in Vault');
        }

        // 5) Registr: READY + ACTIVE. Eski (eski parolli) ulanish hovuzi tashlanadi.
        const now = new Date().toISOString();
        const { error: dbUpdateError } = await this.admin()
          .from('warehouse_tenant_databases')
          .update({
            database_name: names.databaseName,
            database_role: names.databaseRole,
            vault_secret_id: secretId,
            status: 'READY',
            lease_expires_at: null,
            last_error: null,
            provisioned_at: now,
            updated_at: now,
          })
          .eq('tenant_id', tenantId);
        if (dbUpdateError) throw new Error('Could not update warehouse database registry');
        await this.evictPool(tenantId);

        const { error: tenantUpdateError } = await this.admin()
          .from('warehouse_tenants')
          .update({ status: 'ACTIVE', updated_at: now })
          .eq('id', tenantId);
        if (tenantUpdateError) {
          throw new Error('Could not activate warehouse tenant after database provisioning');
        }
        await this.logEvent(
          tenantId,
          'database.provisioned',
          'SUCCESS',
          'Warehouse database provisioned and verified',
        );
      } finally {
        await control
          .query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey])
          .catch(() => undefined);
      }
    } finally {
      await control.end().catch(() => undefined);
    }
  }

  private async logEvent(tenantId: string, eventType: string, status: string, message: string) {
    await this.admin()
      .from('warehouse_provisioning_events')
      .insert({ tenant_id: tenantId, event_type: eventType, status, message });
  }

  // ---------------------------------------------------------------------------
  // Kompaniya foydalanuvchilari (subdomen orqali)
  // ---------------------------------------------------------------------------
  async assertMembership(tenantId: string, userId: string) {
    const { data, error } = await this.admin()
      .from('warehouse_tenant_memberships')
      .select('role,status')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data || data.status !== 'ACTIVE') {
      throw new ForbiddenException('No active membership in this warehouse tenant');
    }
    return data as { role: string; status: string };
  }

  async resolveTenantByHost(host: string) {
    const hostname = host.toLowerCase().split(':')[0];
    const { data, error } = await this.admin()
      .from('warehouse_tenant_domains')
      .select('tenant_id,warehouse_tenants!inner(id,name,slug,status)')
      .eq('hostname', hostname)
      .maybeSingle();
    if (error || !data) throw new NotFoundException('Warehouse tenant domain not found');
    const tenant = data.warehouse_tenants as unknown as {
      id: string;
      name: string;
      slug: string;
      status: string;
    };
    if (tenant.status !== 'ACTIVE') throw new ForbiddenException('Warehouse tenant is not active');
    return tenant;
  }

  /**
   * Caddy on-demand TLS 'ask' — sertifikat faqat ro'yxatdagi kompaniya domeni
   * (yoki asosiy sklad domeni) uchun so'raladi. Aks holda istalgan
   * xxx.sklad.clary.uz so'rovi Let's Encrypt limitini yeb qo'yardi.
   */
  async isTlsAllowedHost(host: string): Promise<boolean> {
    const hostname = (host ?? '').toLowerCase().trim();
    const base = (process.env.WAREHOUSE_BASE_DOMAIN ?? 'sklad.clary.uz').toLowerCase();
    if (!hostname) return false;
    if (hostname === base) return true;
    if (!hostname.endsWith(`.${base}`)) return false;
    const { data, error } = await this.admin()
      .from('warehouse_tenant_domains')
      .select('tenant_id,warehouse_tenants!inner(status)')
      .eq('hostname', hostname)
      .neq('warehouse_tenants.status', 'DELETING')
      .maybeSingle();
    return !error && !!data;
  }

  async tenantContextFromRequest(host: string, userId: string | null) {
    if (!userId) throw new ForbiddenException();
    const tenant = await this.resolveTenantByHost(host);
    const membership = await this.assertMembership(tenant.id, userId);
    return { tenant, membership };
  }

  async withTenantPool<T>(tenantId: string, work: (pool: Pool) => Promise<T>): Promise<T> {
    let pool = this.tenantPools.get(tenantId);
    if (!pool) {
      const { data: row, error } = await this.admin()
        .from('warehouse_tenant_databases')
        .select('vault_secret_id,status')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (error || !row || row.status !== 'READY' || !row.vault_secret_id) {
        throw new ServiceUnavailableException('Warehouse database is not ready');
      }
      const { data: secret, error: secretError } = await this.admin().rpc(
        'get_warehouse_db_secret',
        { p_tenant_id: tenantId },
      );
      if (secretError || typeof secret !== 'string' || !secret) {
        throw new ServiceUnavailableException('Warehouse database credentials unavailable');
      }
      pool = new Pool({
        connectionString: secret,
        max: Number(process.env.WAREHOUSE_TENANT_POOL_MAX ?? 5),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
        ssl: sslConfig(),
      });
      // Hovuz xatosi (baza qayta ishga tushdi va h.k.) jarayonni yiqitmasin.
      pool.on('error', (e) => this.log.warn(`Tenant ${tenantId} pool: ${redactInfraError(e)}`));
      this.tenantPools.set(tenantId, pool);
    }
    return work(pool);
  }

  private async evictPool(tenantId: string) {
    const pool = this.tenantPools.get(tenantId);
    if (!pool) return;
    this.tenantPools.delete(tenantId);
    await pool.end().catch(() => undefined);
  }

  async closePools() {
    await Promise.all([...this.tenantPools.values()].map((pool) => pool.end()));
    this.tenantPools.clear();
  }

  async onModuleDestroy() {
    await this.closePools();
  }
}
