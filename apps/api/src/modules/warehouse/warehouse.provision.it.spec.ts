// =============================================================================
// INTEGRATSION sinov — haqiqiy PostgreSQL bilan (CI'da O'TKAZIB yuboriladi).
// =============================================================================
// Ishga tushirish (lokal, bo'sh sinov serveri — PROD EMAS):
//   SKLAD_IT_PG_URL=postgresql://postgres@localhost:55432/postgres \
//     ./node_modules/.bin/vitest run src/modules/warehouse/warehouse.provision.it.spec.ts
// Control-plane (Supabase) xotirada soxtalashtiriladi; data-plane — haqiqiy:
// baza/rol yaratish, sxema, ACL va ikki kompaniya izolyatsiyasi tekshiriladi.
// =============================================================================
import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { warehouseDatabaseNames } from './warehouse-utils';
import { WarehouseService } from './warehouse.service';

const PG_URL = process.env.SKLAD_IT_PG_URL;

type Row = Record<string, unknown>;

/** Supabase admin klientining Sklad servisi ishlatadigan qismi (xotirada). */
function fakeSupabase() {
  const tables: Record<string, Row[]> = {
    warehouse_tenants: [],
    warehouse_tenant_databases: [],
    warehouse_provisioning_events: [],
  };
  const secrets = new Map<string, { id: string; value: string }>();

  const builder = (table: string) => {
    let filters: Array<[string, unknown]> = [];
    let patch: Row | null = null;
    const rows = () =>
      (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
    const run = () => {
      if (patch) for (const r of rows()) Object.assign(r, patch);
      return { data: null, error: null };
    };
    const b = {
      select: () => b,
      order: () => b,
      eq: (k: string, v: unknown) => {
        filters = [...filters, [k, v]];
        return b;
      },
      update: (p: Row) => {
        patch = p;
        return b;
      },
      insert: async (row: Row) => {
        (tables[table] ??= []).push({ ...row });
        return { data: null, error: null };
      },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return b;
  };

  const admin = {
    from: (t: string) => builder(t),
    rpc: async (fn: string, args: Row) => {
      if (fn === 'upsert_warehouse_db_secret') {
        const name = String(args.p_name);
        const cur = secrets.get(name) ?? { id: randomUUID(), value: '' };
        cur.value = String(args.p_secret);
        secrets.set(name, cur);
        return { data: cur.id, error: null };
      }
      if (fn === 'get_warehouse_db_secret') {
        const db = tables.warehouse_tenant_databases!.find((r) => r.tenant_id === args.p_tenant_id);
        if (!db || db.status !== 'READY') return { data: null, error: null };
        const s = [...secrets.values()].find((x) => x.id === db.vault_secret_id);
        return { data: s?.value ?? null, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    },
  };
  return { tables, secrets, service: { admin: () => admin } };
}

describe.skipIf(!PG_URL)('Sklad provisioning — haqiqiy PostgreSQL', () => {
  const fake = fakeSupabase();
  const svc = new WarehouseService(fake.service as never);
  const t1 = randomUUID();
  const t2 = randomUUID();
  const owner = randomUUID();

  const addTenant = (id: string, slug: string) => {
    fake.tables.warehouse_tenants!.push({
      id,
      name: slug,
      slug,
      status: 'PROVISIONING',
      owner_user_id: owner,
      plan_code: 'starter',
    });
    fake.tables.warehouse_tenant_databases!.push({ tenant_id: id, status: 'PROVISIONING' });
  };

  const adminQuery = async (sql: string, params: unknown[] = []) => {
    const c = new Client({ connectionString: PG_URL });
    await c.connect();
    try {
      return await c.query(sql, params);
    } finally {
      await c.end();
    }
  };

  beforeAll(() => {
    process.env.WAREHOUSE_DATABASE_ADMIN_URL = PG_URL;
    process.env.WAREHOUSE_DATABASE_SSLMODE = 'disable';
    addTenant(t1, 'alfa');
    addTenant(t2, 'beta');
  });

  afterAll(async () => {
    await svc.closePools();
    for (const id of [t1, t2]) {
      const n = warehouseDatabaseNames(id);
      await adminQuery(`DROP DATABASE IF EXISTS "${n.databaseName}" WITH (FORCE)`).catch(() => {});
      await adminQuery(`DROP ROLE IF EXISTS "${n.databaseRole}"`).catch(() => {});
    }
  });

  it('kompaniya bazasini yaratadi va ACTIVE qiladi', async () => {
    await svc.provisionTenant(t1);
    const t = fake.tables.warehouse_tenants!.find((r) => r.id === t1)!;
    const db = fake.tables.warehouse_tenant_databases!.find((r) => r.tenant_id === t1)!;
    expect(t.status).toBe('ACTIVE');
    expect(db.status).toBe('READY');
    expect(db.vault_secret_id).toBeTruthy();
    const names = warehouseDatabaseNames(t1);
    const exists = await adminQuery('SELECT 1 FROM pg_database WHERE datname = $1', [
      names.databaseName,
    ]);
    expect(exists.rowCount).toBe(1);
  });

  it('kompaniya o‘z bazasida ishlay oladi (mahsulotlar jadvali bo‘sh)', async () => {
    const rows = await svc.withTenantPool(t1, async (pool) => {
      const r = await pool.query('SELECT count(*)::int AS n FROM products');
      return r.rows[0].n as number;
    });
    expect(rows).toBe(0);
  });

  it('qayta ishga tushirish xavfsiz (idempotent) — yangi parol Vault’da yangilanadi', async () => {
    const before = [...fake.secrets.values()][0]!.value;
    fake.tables.warehouse_tenants!.find((r) => r.id === t1)!.status = 'PROVISIONING';
    await svc.provisionTenant(t1);
    const after = [...fake.secrets.values()][0]!.value;
    expect(fake.secrets.size).toBe(1); // bitta sir, nomi band xatosi yo'q
    expect(after).not.toBe(before);
    // eski parolli hovuz tashlangan — yangi ulanish ishlaydi
    const n = await svc.withTenantPool(t1, async (pool) => (await pool.query('SELECT 1')).rowCount);
    expect(n).toBe(1);
  });

  it('IZOLYATSIYA: 1-kompaniya roli 2-kompaniya bazasiga ulana olmaydi', async () => {
    await svc.provisionTenant(t2);
    const n1 = warehouseDatabaseNames(t1);
    const n2 = warehouseDatabaseNames(t2);
    const url = new URL(PG_URL!);
    url.username = n1.databaseRole;
    url.pathname = `/${n2.databaseName}`;
    const c = new Client({ connectionString: url.toString() });
    // 42501 = insufficient_privilege (server tili qanday bo'lmasin — kod bo'yicha)
    await expect(c.connect()).rejects.toMatchObject({ code: '42501' });
    await c.end().catch(() => {});
  });

  it('IZOLYATSIYA: PUBLIC kompaniya bazasiga CONNECT huquqiga ega emas', async () => {
    const n2 = warehouseDatabaseNames(t2);
    const r = await adminQuery(
      "SELECT has_database_privilege('public', $1, 'CONNECT') AS pub",
      [n2.databaseName],
    );
    expect(r.rows[0].pub).toBe(false);
  });
});
