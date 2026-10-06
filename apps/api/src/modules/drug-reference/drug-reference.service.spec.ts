import { describe, expect, it, vi } from 'vitest';

import { MXIK_HARVEST_TARGETS, type MxikRawRow } from '@clary/utils';

import type { SupabaseService } from '../../common/services/supabase.service';
import { DrugReferenceService } from './drug-reference.service';
import { gtinSearchTerms, type MxikClient } from './mxik-client';

// -----------------------------------------------------------------------------
// Soxta Supabase: so'rov zanjirini yozib boradi, javobni handler beradi
// -----------------------------------------------------------------------------
type Op = [string, ...unknown[]];
type Res = { data: unknown; error: { message: string } | null; count?: number };

function fakeSupabase(handlers: {
  rpc?: (name: string, args: Record<string, unknown>) => Res;
  table?: (table: string, ops: Op[]) => Res;
}) {
  const calls: Array<{ kind: 'rpc' | 'table'; name: string; args?: unknown; ops?: Op[] }> = [];
  const builder = (table: string) => {
    const ops: Op[] = [];
    const entry = { kind: 'table' as const, name: table, ops };
    calls.push(entry);
    const proxy: unknown = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') {
            const res = handlers.table?.(table, ops) ?? { data: null, error: null };
            return (ok: (v: Res) => unknown, fail: (e: unknown) => unknown) =>
              Promise.resolve(res).then(ok, fail);
          }
          return (...args: unknown[]) => {
            ops.push([prop, ...args]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  };
  const admin = {
    from: (t: string) => builder(t),
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      calls.push({ kind: 'rpc', name, args });
      return handlers.rpc?.(name, args) ?? { data: null, error: null };
    },
  };
  return { svc: { admin: () => admin } as unknown as SupabaseService, calls };
}

const has = (ops: Op[], name: string) => ops.some((o) => o[0] === name);

function raw(i: number, classCode = '03004'): MxikRawRow {
  const tail = String(i).padStart(6, '0');
  return {
    mxikCode: `${classCode}${'0'.repeat(6)}${tail}`.slice(0, 17),
    classCode,
    brand: `${classCode}000000${tail.slice(0, 3)}-ПРЕПАРАТ ${i} (Factory ${i})`,
    attribute: 'Таблетки 500 мг блистеры №20(2x10)',
    subPosition: `${classCode}000000-Парацетамол - N02BE01`,
    position: '',
    units: 'шт (таблетка (500 мг))',
    packageName: '',
    mnn: 'парацетамол',
    lgotaName: '(ст.243 НК)',
    gtin: '',
  };
}

describe('DrugReferenceService.runSync', () => {
  it('sahifalab yuklaydi, faqat to‘liq sinflarni nofaol qiladi', async () => {
    const upserts: unknown[][] = [];
    let deactivateArgs: Record<string, unknown> | null = null;
    const db = fakeSupabase({
      rpc: (name, args) => {
        if (name === 'drug_reference_upsert') {
          upserts.push(args['p_rows'] as unknown[]);
          return { data: (args['p_rows'] as unknown[]).length, error: null };
        }
        if (name === 'drug_reference_deactivate_stale') {
          deactivateArgs = args;
          return { data: 7, error: null };
        }
        return { data: 0, error: null };
      },
    });
    const pages: Record<string, MxikRawRow[][]> = {
      '03004': [
        Array.from({ length: 1000 }, (_, i) => raw(i)),
        Array.from({ length: 1000 }, (_, i) => raw(1000 + i)),
        Array.from({ length: 500 }, (_, i) => raw(2000 + i)),
      ],
    };
    const mxik = {
      classPage: vi.fn(async (t: { classCode: string }, page: number) => {
        if (t.classCode === '09018') throw new Error('timeout');
        const list = pages[t.classCode] ?? [];
        return { rows: list[page] ?? [], total: list.reduce((s, p) => s + p.length, 0) };
      }),
    } as unknown as MxikClient;
    const svc = new DrugReferenceService(db.svc, mxik);
    const started = '2026-10-07T00:00:00.000Z';
    await (svc as unknown as { runSync: (id: string, s: string) => Promise<void> }).runSync(
      'log1',
      started,
    );

    expect(upserts.flat()).toHaveLength(2500);
    expect(deactivateArgs).not.toBeNull();
    expect(deactivateArgs!['p_classes']).toEqual(['03004']);
    // 20 kunlik zaxira: bir martalik uzilish yozuvni o'chirmaydi
    expect(deactivateArgs!['p_before']).toBe('2026-09-17T00:00:00.000Z');
    const final = db.calls
      .filter((c) => c.kind === 'table' && c.name === 'drug_reference_sync_log')
      .map((c) => c.ops!.find((o) => o[0] === 'update')?.[1] as Record<string, unknown>)
      .filter(Boolean)
      .pop()!;
    expect(final['status']).toBe('partial');
    expect(final['rows_upserted']).toBe(2500);
    const classes = (
      final['details'] as { classes: Record<string, { error: string | null; complete: boolean }> }
    ).classes;
    expect(classes['09018']!.error).toBe('timeout');
    expect(classes['03004']!.complete).toBe(true);
    expect(Object.keys(classes)).toHaveLength(MXIK_HARVEST_TARGETS.length);
  });
});

describe('DrugReferenceService.lookupCode', () => {
  const ref = {
    mxik_code: '03004026001006002',
    kind: 'drug',
    name: 'ОНДАЛЕК',
    pack_qty: 5,
  };

  it('rasmiy (mxik) manba dorixonalar o‘rgatganidan ustun', async () => {
    const db = fakeSupabase({
      table: (t) => {
        if (t === 'drug_reference_barcodes')
          return {
            data: [
              {
                code: '04820014492228',
                mxik_code: '03004000000000001',
                source: 'clinic',
                confirmations: 9,
              },
              {
                code: '04820014492228',
                mxik_code: ref.mxik_code,
                source: 'mxik',
                confirmations: 1,
              },
            ],
            error: null,
          };
        if (t === 'drug_reference')
          return { data: [ref, { ...ref, mxik_code: '03004000000000001' }], error: null };
        return { data: null, error: null };
      },
    });
    const svc = new DrugReferenceService(db.svc, {} as MxikClient);
    const r = await svc.lookupCode('4820014492228');
    expect(r.source).toBe('mxik');
    expect(r.reference?.mxik_code).toBe(ref.mxik_code);
    expect(r.reference?.barcode).toBe('04820014492228');
  });

  it('katalogda yo‘q: live=false — bo‘sh; live=true — MXIK, keyin xotirada', async () => {
    const db = fakeSupabase({
      table: (t, ops) => {
        if (t === 'drug_reference_barcodes') return { data: [], error: null };
        if (t === 'drug_reference' && has(ops, 'maybeSingle')) return { data: ref, error: null };
        return { data: [], error: null };
      },
      rpc: () => ({ data: 1, error: null }),
    });
    const searchByGtin = vi.fn(async () => [
      {
        mxikCode: ref.mxik_code,
        classCode: '03004',
        brand: 'ОНДАЛЕК (Лекхим-Харьков)',
        attribute: 'Раствор для инъекций 2 мг/мл 4 ампулы №5(1x5)',
        subPosition: 'Ондансетрон - A04AA01',
        position: '',
        units: 'шт (ампула)',
        packageName: '',
        mnn: 'ондансетрон',
        lgotaName: '',
        gtin: '4820014492228',
      },
      // boshqa kod — e'tiborga olinmaydi
      { ...raw(1), gtin: '4780086540633' },
    ]);
    const svc = new DrugReferenceService(db.svc, { searchByGtin } as unknown as MxikClient);
    expect((await svc.lookupCode('4820014492228')).reference).toBeNull();
    expect(searchByGtin).not.toHaveBeenCalled();

    const r = await svc.lookupCode('4820014492228', { live: true });
    expect(r.source).toBe('live');
    expect(r.reference?.name).toBe('ОНДАЛЕК');
    const up = db.calls.find((c) => c.kind === 'rpc' && c.name === 'drug_reference_upsert')!;
    expect((up.args as Record<string, unknown>)['p_source']).toBe('live');
    expect(((up.args as Record<string, unknown>)['p_rows'] as unknown[]).length).toBe(1);

    // Topilmagan kod 6 soat qayta so'ralmaydi
    searchByGtin.mockResolvedValueOnce([]);
    await svc.lookupCode('4600000000008', { live: true });
    await svc.lookupCode('4600000000008', { live: true });
    expect(searchByGtin).toHaveBeenCalledTimes(2);
  });

  it('GTIN bo‘lmagan kod (ichki matn) — so‘rov yo‘q', async () => {
    const db = fakeSupabase({});
    const svc = new DrugReferenceService(db.svc, {} as MxikClient);
    expect((await svc.lookupCode('ABC-12')).reference).toBeNull();
    expect(db.calls).toHaveLength(0);
  });
});

describe('DrugReferenceService.adopt', () => {
  it('qadoq kodlarini oladi, sotuv birligiga mos kodni va DataMatrix GTIN’ini yuboradi', async () => {
    let adoptArgs: Record<string, unknown> | null = null;
    const db = fakeSupabase({
      table: (t, ops) => {
        if (t === 'drug_reference' && has(ops, 'maybeSingle'))
          return {
            data: {
              mxik_code: '03004026001006001',
              pack_qty: 5,
              packages: null,
              packages_fetched_at: null,
            },
            error: null,
          };
        return { data: null, error: null };
      },
      rpc: (name, args) => {
        if (name === 'pharmacy_adopt_reference') adoptArgs = args;
        return { data: { medication_id: 'm1', created: true }, error: null };
      },
    });
    const packages = vi.fn(async () => [
      { code: '1164638', name: 'шт (ампула)', qty: 1 },
      { code: '1165125', name: 'упаковка=5 шт (ампула)', qty: 5 },
    ]);
    const svc = new DrugReferenceService(db.svc, { packages } as unknown as MxikClient);
    const dm =
      '0104820014492228215ABCDEFGHIJKL\u001d91EE07\u001d92abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH';
    const r = await svc.adopt('c1', 'u1', {
      mxik_code: '03004026001006001',
      barcode: dm,
      sell_by_unit: false,
    });
    expect(r).toEqual({ medication_id: 'm1', created: true });
    expect(packages).toHaveBeenCalledOnce();
    expect(adoptArgs).toMatchObject({
      p_clinic: 'c1',
      p_user: 'u1',
      p_mxik: '03004026001006001',
      p_barcode: '04820014492228',
      p_package_code: '1165125',
    });
    const saved = db.calls.find(
      (c) => c.kind === 'table' && c.name === 'drug_reference' && has(c.ops!, 'update'),
    );
    expect(saved).toBeTruthy();
  });

  it('qadoq kodi olinmasa ham dori qo‘shiladi', async () => {
    const db = fakeSupabase({
      table: (t, ops) =>
        t === 'drug_reference' && has(ops, 'maybeSingle')
          ? {
              data: {
                mxik_code: '03004026001006001',
                pack_qty: 5,
                packages: null,
                packages_fetched_at: null,
              },
              error: null,
            }
          : { data: null, error: null },
      rpc: () => ({ data: { medication_id: 'm2', created: false, reason: 'mxik' }, error: null }),
    });
    const svc = new DrugReferenceService(db.svc, {
      packages: vi.fn(async () => {
        throw new Error('timeout');
      }),
    } as unknown as MxikClient);
    const r = await svc.adopt('c1', 'u1', { mxik_code: '03004026001006001' });
    expect(r.medication_id).toBe('m2');
    const call = db.calls.find((c) => c.kind === 'rpc')!;
    expect((call.args as Record<string, unknown>)['p_package_code']).toBeNull();
  });
});

describe('gtinSearchTerms', () => {
  it('MXIK yozgan ko‘rinishlar: EAN-13, UPC-A, EAN-8', () => {
    expect(gtinSearchTerms('04820014492228')).toEqual(['4820014492228']);
    expect(gtinSearchTerms('00089041809032')).toEqual(['0089041809032', '089041809032']);
    expect(gtinSearchTerms('00000046002686')).toEqual([
      '46002686',
      '0000046002686',
      '000046002686',
    ]);
    expect(gtinSearchTerms('14820014492225')).toEqual(['14820014492225']);
  });
});
