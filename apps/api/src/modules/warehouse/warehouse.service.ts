import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Client, Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { SupabaseService } from '../../common/services/supabase.service';
import { WAREHOUSE_INITIAL_SCHEMA, WAREHOUSE_SCHEMA_VERSION } from './warehouse-schema';
import { warehouseDatabaseNames, warehouseHostname, quotePostgresIdentifier } from './warehouse-utils';

export const WAREHOUSE_PROVISION_QUEUE = 'warehouse-provisioning';

type WarehouseTenant = {
  id: string;
  name: string;
  slug: string;
  status: string;
  owner_user_id: string;
  plan_code: string;
};

@Injectable()
export class WarehouseService {
  private readonly logger = new Logger(WarehouseService.name);
  private readonly tenantPools = new Map<string, Pool>();

  constructor(
    private readonly supabase: SupabaseService,
    @InjectQueue(WAREHOUSE_PROVISION_QUEUE) private readonly queue: Queue,
  ) {}

  private admin() {
    return this.supabase.admin();
  }

  async createTenant(input: {
    name: string;
    slug: string;
    owner_user_id: string;
    plan_code?: string;
  }, actorId: string) {
    const baseDomain = process.env.WAREHOUSE_BASE_DOMAIN ?? 'sklad.clary.uz';
    const hostname = warehouseHostname(input.slug, baseDomain);

    const { data: owner, error: ownerError } = await this.admin()
      .auth.admin.getUserById(input.owner_user_id);
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
      if (/duplicate|unique/i.test(error.message)) throw new ConflictException('Warehouse slug or hostname already exists');
      throw new ServiceUnavailableException('Warehouse tenant registry could not be created');
    }

    const tenantId = data as string;
    try {
      await this.queue.add('provision-tenant', { tenantId }, {
      jobId: `warehouse-provision-${tenantId}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 500,
        removeOnFail: 1000,
      });
    } catch {
      await this.setProvisioningState(tenantId, 'FAILED', 'Provisioning queue is unavailable; retry from Super Admin.');
      throw new ServiceUnavailableException('Warehouse tenant was registered but provisioning could not be queued');
    }

    return { tenant_id: tenantId, hostname, status: 'PENDING' };
  }

  async retryProvisioning(tenantId: string) {
    const { data: tenant, error } = await this.admin()
      .from('warehouse_tenants')
      .select('id,status')
      .eq('id', tenantId)
      .maybeSingle();
    if (error || !tenant) throw new NotFoundException('Warehouse tenant not found');
    if (tenant.status === 'ACTIVE') throw new ConflictException('Warehouse tenant is already active');
    await this.admin().from('warehouse_tenants')
      .update({ status: 'PENDING', updated_at: new Date().toISOString() })
      .eq('id', tenantId);
    await this.queue.add('provision-tenant', { tenantId }, {
      jobId: `warehouse-provision-retry-${tenantId}-${Date.now()}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 500,
      removeOnFail: 1000,
    });
    return { tenant_id: tenantId, status: 'PENDING' };
  }

  async listTenants() {
    const { data, error } = await this.admin()
      .from('warehouse_tenants')
      .select('id,name,slug,owner_user_id,plan_code,status,created_at,warehouse_tenant_domains(hostname),warehouse_tenant_databases(status,last_error,provisioned_at)')
      .order('created_at', { ascending: false });
    if (error) throw new ServiceUnavailableException('Warehouse tenant registry unavailable');
    return data ?? [];
  }

  async getTenant(tenantId: string) {
    const { data, error } = await this.admin()
      .from('warehouse_tenants')
      .select('id,name,slug,owner_user_id,plan_code,status,created_at,warehouse_tenant_domains(hostname),warehouse_tenant_databases(status,last_error,provisioned_at),warehouse_provisioning_events(event_type,status,message,created_at)')
      .eq('id', tenantId)
      .maybeSingle();
    if (error) throw new ServiceUnavailableException('Warehouse tenant registry unavailable');
    if (!data) throw new NotFoundException('Warehouse tenant not found');
    return data;
  }

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
    const databaseUrl = new URL(adminUrl);
    databaseUrl.pathname = `/${names.databaseName}`;
    databaseUrl.username = names.databaseRole;
    databaseUrl.password = password;

    await this.setProvisioningState(tenantId, 'PROVISIONING', 'Provisioning started');

    const client = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 10000 });
    try {
      await client.connect();
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [`clary-warehouse:${tenantId}`]);

      const dbExists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [names.databaseName]);
      const roleExists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [names.databaseRole]);
      // Password is generated locally as base64url (no quotes or SQL metacharacters).
      if (roleExists.rowCount === 0) {
        await client.query(`CREATE ROLE ${quotePostgresIdentifier(names.databaseRole)} LOGIN PASSWORD '${password}'`);
      } else {
        await client.query(`ALTER ROLE ${quotePostgresIdentifier(names.databaseRole)} WITH LOGIN PASSWORD '${password}'`);
      }
      if (dbExists.rowCount === 0) {
        await client.query(`CREATE DATABASE ${quotePostgresIdentifier(names.databaseName)} OWNER ${quotePostgresIdentifier(names.databaseRole)}`);
      }
      await client.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${quotePostgresIdentifier(names.databaseName)} TO ${quotePostgresIdentifier(names.databaseRole)}`);
    } finally {
      try { await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`clary-warehouse:${tenantId}`]); } catch { /* connection may have failed */ }
      await client.end().catch(() => undefined);
    }

    const tenantClient = new Client({
      connectionString: databaseUrl.toString(),
      connectionTimeoutMillis: 10000,
      ssl: process.env.WAREHOUSE_DATABASE_SSLMODE === 'disable'
        ? false
        : { rejectUnauthorized: process.env.WAREHOUSE_DATABASE_REJECT_UNAUTHORIZED !== 'false' },
    });
    try {
      await tenantClient.connect();
      for (const statement of WAREHOUSE_INITIAL_SCHEMA) await tenantClient.query(statement);
      await tenantClient.query(
        'INSERT INTO warehouse_meta (singleton, tenant_id, schema_version) VALUES (TRUE, $1, $2) ON CONFLICT (singleton) DO UPDATE SET schema_version = EXCLUDED.schema_version',
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

    const { data: secretId, error: secretError } = await this.admin().rpc('create_warehouse_db_secret', {
      p_secret: databaseUrl.toString(),
      p_name: `clary-warehouse-${tenantId}`,
    });
    if (secretError || !secretId) throw new Error('Could not store warehouse database credentials in Vault');

    const { error: dbUpdateError } = await this.admin()
      .from('warehouse_tenant_databases')
      .update({
        database_name: names.databaseName,
        database_role: names.databaseRole,
        vault_secret_id: secretId,
        status: 'READY',
        last_error: null,
        provisioned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId);
    if (dbUpdateError) throw new Error('Could not update warehouse database registry');

    await this.admin()
      .from('warehouse_tenants')
      .update({ status: 'ACTIVE', updated_at: new Date().toISOString() })
      .eq('id', tenantId);

    await this.logEvent(tenantId, 'database.provisioned', 'SUCCESS', 'Warehouse database provisioned and verified');
  }

  async markProvisioningFailed(tenantId: string, error: unknown) {
    const rawMessage = error instanceof Error ? error.message : 'Unknown provisioning error';
    const safeMessage = rawMessage
      .replace(/postgres(?:ql)?:\\/\\/[^\\s]+/gi, '[database connection redacted]')
      .slice(0, 500);
    await this.setProvisioningState(tenantId, 'FAILED', safeMessage);
  }

  private async setProvisioningState(tenantId: string, status: string, message: string) {
    await this.admin().from('warehouse_tenants').update({ status, updated_at: new Date().toISOString() }).eq('id', tenantId);
    await this.admin().from('warehouse_tenant_databases')
      .update({ status: status === 'ACTIVE' ? 'READY' : status, last_error: status === 'FAILED' ? message : null, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId);
    await this.logEvent(tenantId, 'database.provisioning', status === 'FAILED' ? 'ERROR' : 'INFO', message);
  }

  private async logEvent(tenantId: string, eventType: string, status: string, message: string) {
    await this.admin().from('warehouse_provisioning_events').insert({
      tenant_id: tenantId, event_type: eventType, status, message,
    });
  }

  async assertMembership(tenantId: string, userId: string) {
    const { data, error } = await this.admin().from('warehouse_tenant_memberships')
      .select('role,status')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data || data.status !== 'ACTIVE') throw new ForbiddenException('No active membership in this warehouse tenant');
    return data as { role: string; status: string };
  }

  async resolveTenantByHost(host: string) {
    const hostname = host.toLowerCase().split(':')[0];
    const { data, error } = await this.admin().from('warehouse_tenant_domains')
      .select('tenant_id,warehouse_tenants!inner(id,name,slug,status)')
      .eq('hostname', hostname)
      .maybeSingle();
    if (error || !data) throw new NotFoundException('Warehouse tenant domain not found');
    const tenant = data.warehouse_tenants as unknown as { id: string; name: string; slug: string; status: string };
    if (tenant.status !== 'ACTIVE') throw new ForbiddenException('Warehouse tenant is not active');
    return tenant;
  }

  async withTenantPool<T>(tenantId: string, work: (pool: Pool) => Promise<T>): Promise<T> {
    let pool = this.tenantPools.get(tenantId);
    if (!pool) {
      const { data: row, error } = await this.admin().from('warehouse_tenant_databases')
        .select('vault_secret_id,status')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (error || !row || row.status !== 'READY' || !row.vault_secret_id) {
        throw new ServiceUnavailableException('Warehouse database is not ready');
      }
        const { data: secret, error: secretError } = await this.admin().rpc('get_warehouse_db_secret', {
        p_tenant_id: tenantId,
      });
      if (secretError || typeof secret !== 'string' || !secret) throw new ServiceUnavailableException('Warehouse database credentials unavailable');
      pool = new Pool({
        connectionString: secret,
        max: Number(process.env.WAREHOUSE_TENANT_POOL_MAX ?? 5),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        ssl: process.env.WAREHOUSE_DATABASE_SSLMODE === 'disable' ? false : { rejectUnauthorized: process.env.WAREHOUSE_DATABASE_REJECT_UNAUTHORIZED !== 'false' },
      });
      this.tenantPools.set(tenantId, pool);
    }
    return work(pool);
  }

  async tenantContextFromRequest(host: string, userId: string | null) {
    if (!userId) throw new ForbiddenException();
    const tenant = await this.resolveTenantByHost(host);
    const membership = await this.assertMembership(tenant.id, userId);
    return { tenant, membership };
  }

  async closePools() {
    await Promise.all([...this.tenantPools.values()].map((pool) => pool.end()));
    this.tenantPools.clear();
  }
}
