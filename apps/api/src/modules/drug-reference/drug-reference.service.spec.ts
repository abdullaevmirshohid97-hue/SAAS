import { describe, expect, it, vi } from 'vitest';

import { MXIK_HARVEST_TARGETS, gtinSearchTerms, type MxikRawRow } from '@clary/utils';

import type { SupabaseService } from '../../common/services/supabase.service';
import { DrugReferenceService } from './drug-reference.service';
import type { MxikClient } from './mxik-client';

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
      isAvailable: () => true,
      status: () => ({ available: true, last_error: null, retry_at: null }),
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

describe('Server MXIK’ga ulana olmasa', () => {
  it('birinchi tarmoq xatosidan keyin qolgan sinflar kutilmaydi, xabar brauzer yo‘lini aytadi', async () => {
    let available = true;
    const classPage = vi.fn(async () => {
      available = false;
      throw new Error('MXIK API javob bermadi: fetch failed: ECONNREFUSED');
    });
    const mxik = {
      classPage,
      isAvailable: () => available,
      status: () => ({ available, last_error: 'fetch failed: ECONNREFUSED', retry_at: null }),
    } as unknown as MxikClient;
    const updates: Array<Record<string, unknown>> = [];
    const db = fakeSupabase({
      table: (t, ops) => {
        const u = ops.find((o) => o[0] === 'update');
        if (t === 'drug_reference_sync_log' && u) updates.push(u[1] as Record<string, unknown>);
        return { data: null, error: null };
      },
      rpc: () => ({ data: 0, error: null }),
    });
    const svc = new DrugReferenceService(db.svc, mxik);
    await (svc as unknown as { runSync: (id: string, s: string) => Promise<void> }).runSync(
      'l1',
      '2026-10-07T00:00:00.000Z',
    );
    expect(classPage).toHaveBeenCalledTimes(1);
    const last = updates.pop()!;
    expect(last['status']).toBe('error');
    expect(String(last['error'])).toContain('Brauzer orqali yuklash');
  });

  it('brauzer orqali yuklash: yakunda faqat to‘liq sinflar nofaol qilinadi', async () => {
    let deactivate: Record<string, unknown> | null = null;
    const db = fakeSupabase({
      table: (t, ops) =>
        t === 'drug_reference_sync_log' && has(ops, 'maybeSingle')
          ? { data: { status: 'running', started_at: '2026-10-07T00:00:00.000Z' }, error: null }
          : { data: null, error: null },
      rpc: (name, args) => {
        if (name === 'drug_reference_deactivate_stale') deactivate = args;
        return { data: 3, error: null };
      },
    });
    const svc = new DrugReferenceService(db.svc, {
      isAvailable: () => false,
      status: () => ({ available: false, last_error: 'x', retry_at: null }),
    } as unknown as MxikClient);
    const p = (complete: boolean, error: string | null = null) => ({
      label: 'x',
      total: 10,
      fetched: complete ? 10 : 3,
      mapped: 10,
      upserted: complete ? 10 : 3,
      complete,
      error,
    });
    const r = await svc.browserSyncFinish('11111111-1111-4111-8111-111111111111', {
      '03004': p(true),
      '02106999028': p(true),
      '09018': p(false, 'CORS'),
    });
    expect(r.status).toBe('partial');
    expect(deactivate!['p_classes']).toEqual(['03004', '02106']);
  });
});

describe('describeFetchError', () => {
  it('"fetch failed" ortidagi sabab ko‘rinadi', async () => {
    const { describeFetchError } = await import('./mxik-client');
    const e = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED 109.207.242.14:443'), {
        code: 'ECONNREFUSED',
      }),
    });
    expect(describeFetchError(e)).toBe(
      'fetch failed: ECONNREFUSED — connect ECONNREFUSED 109.207.242.14:443',
    );
    const t = new Error('x');
    t.name = 'TimeoutError';
    expect(describeFetchError(t)).toBe('vaqt tugadi (javob kelmadi)');
  });
});

describe('O‘z bazadagi dori: suggestFor / enrich', () => {
  const MED = '22222222-2222-4222-8222-222222222222';
  const ref = {
    mxik_code: '03004141006001001',
    kind: 'drug',
    name: 'НУРОФЕН®',
    strength: '200 мг',
    pack_qty: 10,
    manufacturer: 'Reckitt Benckiser',
  };

  it('shtrix-kod katalogda — aniq moslik (barcode)', async () => {
    const db = fakeSupabase({
      table: (t, ops) => {
        if (t === 'medications' && has(ops, 'maybeSingle'))
          return {
            data: {
              id: MED,
              name: 'Nurofen',
              strength: null,
              pack_qty: 1,
              barcode: null,
              mxik_code: null,
            },
            error: null,
          };
        if (t === 'medication_barcodes') return { data: [{ code: '05000158062917' }], error: null };
        if (t === 'drug_reference_barcodes')
          return {
            data: [
              {
                code: '05000158062917',
                mxik_code: ref.mxik_code,
                source: 'mxik',
                confirmations: 1,
              },
            ],
            error: null,
          };
        if (t === 'drug_reference') return { data: [ref], error: null };
        return { data: [], error: null };
      },
    });
    const svc = new DrugReferenceService(db.svc, {} as MxikClient);
    const r = await svc.suggestFor('c1', MED);
    expect(r.by).toBe('barcode');
    expect(r.reference?.mxik_code).toBe(ref.mxik_code);
  });

  it('nomi + dozasi bir xil (lotin ↔ kirill) — name; qadoq soni mosi afzal', async () => {
    const db = fakeSupabase({
      table: (t, ops) => {
        if (t === 'medications' && has(ops, 'maybeSingle'))
          return {
            data: {
              id: MED,
              name: 'Nurofen',
              strength: '200mg',
              pack_qty: 10,
              barcode: null,
              mxik_code: null,
            },
            error: null,
          };
        return { data: [], error: null };
      },
      rpc: () => ({
        data: [
          { ...ref, mxik_code: '03004141006001002', pack_qty: 20 },
          { ...ref, pack_qty: 10 },
          { ...ref, mxik_code: '03004141006009001', name: 'НУРОФЕН® ЭКСПРЕСС' },
        ],
        error: null,
      }),
    });
    const svc = new DrugReferenceService(db.svc, {} as MxikClient);
    const r = await svc.suggestFor('c1', MED);
    expect(r.by).toBe('name');
    expect(r.candidates).toBe(2);
    expect(r.confident).toBe(true);
    expect(r.reference?.mxik_code).toBe(ref.mxik_code);
  });

  it('mos kelmasa — null', async () => {
    const db = fakeSupabase({
      table: (t, ops) =>
        t === 'medications' && has(ops, 'maybeSingle')
          ? {
              data: {
                id: MED,
                name: 'Mening dorim',
                strength: null,
                pack_qty: 1,
                barcode: null,
                mxik_code: null,
              },
              error: null,
            }
          : { data: [], error: null },
      rpc: () => ({ data: [{ ...ref }], error: null }),
    });
    const r = await new DrugReferenceService(db.svc, {} as MxikClient).suggestFor('c1', MED);
    expect(r).toEqual({ reference: null, by: null, candidates: 0, confident: false });
  });

  it('enrich: faqat bo‘sh maydonlar, nomi/qadoq/narx tegilmaydi', async () => {
    let patch: Record<string, unknown> | null = null;
    const db = fakeSupabase({
      table: (t, ops) => {
        const u = ops.find((o) => o[0] === 'update');
        if (t === 'medications' && u) {
          patch = u[1] as Record<string, unknown>;
          return { data: null, error: null };
        }
        if (t === 'medications')
          return {
            data: {
              id: MED,
              strength: '200mg',
              form: null,
              manufacturer: null,
              generic_name: null,
              mxik_code: null,
              package_code: null,
              vat_percent: null,
              pack_qty: 1,
              sell_by_unit: false,
              requires_prescription: false,
            },
            error: null,
          };
        if (t === 'drug_reference')
          return {
            data: {
              ...ref,
              form: 'Таблетки',
              generic_name: 'ибупрофен',
              vat_exempt: true,
              rx_required: false,
              packages: [
                { code: '11', name: 'шт', qty: 1 },
                { code: '22', name: 'упаковка=10 шт', qty: 10 },
              ],
              packages_fetched_at: '2026-10-07',
            },
            error: null,
          };
        return { data: null, error: null };
      },
    });
    const svc = new DrugReferenceService(db.svc, { packages: vi.fn() } as unknown as MxikClient);
    const r = await svc.enrich('c1', 'u1', { medication_id: MED, mxik_code: ref.mxik_code });
    expect(patch).toMatchObject({
      mxik_code: ref.mxik_code,
      manufacturer: 'Reckitt Benckiser',
      generic_name: 'ибупрофен',
      form: 'Таблетки',
      package_code: '11',
      vat_percent: 0,
    });
    expect(patch).not.toHaveProperty('strength');
    expect(patch).not.toHaveProperty('name');
    expect(patch).not.toHaveProperty('pack_qty');
    expect(r.pack_mismatch).toBe(10);
  });

  it('enrich: boshqa MXIK biriktirilgan bo‘lsa — rad', async () => {
    const db = fakeSupabase({
      table: (t) =>
        t === 'medications'
          ? { data: { id: MED, mxik_code: '03004000000000001', pack_qty: 1 }, error: null }
          : { data: { ...ref, packages: [], packages_fetched_at: '2026-10-07' }, error: null },
    });
    const svc = new DrugReferenceService(db.svc, {} as MxikClient);
    await expect(
      svc.enrich('c1', 'u1', { medication_id: MED, mxik_code: ref.mxik_code }),
    ).rejects.toThrow(/boshqa MXIK/);
  });
});

describe('suggestFor — dorixonadagi haqiqiy nom ko‘rinishi', () => {
  it('"Конкор 5 мг№1" → КОНКОР® 5 мг (doza nom ichida, №1)', async () => {
    const MED = '33333333-3333-4333-8333-333333333333';
    const k = (mx: string, strength: string, pack: number, name = 'КОНКОР®') => ({
      mxik_code: mx,
      kind: 'drug',
      name,
      strength,
      form: 'Таблетки',
      manufacturer: 'Merck',
      pack_qty: pack,
    });
    let searched = '';
    const db = fakeSupabase({
      table: (t, ops) =>
        t === 'medications' && has(ops, 'maybeSingle')
          ? {
              data: {
                id: MED,
                name: 'Конкор 5 мг№1',
                strength: null,
                pack_qty: 1,
                barcode: null,
                mxik_code: null,
              },
              error: null,
            }
          : { data: [], error: null },
      rpc: (_n, args) => {
        searched = String(args['p_q']);
        return {
          data: [
            k('03004000000000010', '10 мг', 30),
            k('03004000000000005', '5 мг', 50),
            k('03004000000000006', '5 мг', 30),
            k('03004000000000025', '2,5 мг', 30, 'КОНКОР® КОР'),
          ],
          error: null,
        };
      },
    });
    const r = await new DrugReferenceService(db.svc, {} as MxikClient).suggestFor('c1', MED);
    expect(searched).toBe('konkor');
    expect(r).toMatchObject({ by: 'name', candidates: 2, confident: true });
    expect(r.reference?.mxik_code).toBe('03004000000000006');
  });
});
