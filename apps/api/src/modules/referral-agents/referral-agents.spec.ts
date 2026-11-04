import { describe, expect, it, vi } from 'vitest';

import type { SupabaseService } from '../../common/services/supabase.service';
import type { CashierService } from '../cashier/cashier.module';
import { ReferralAgentsService } from './referral-agents.module';

// Supabase query builder'ining kichik soxtasi (transactions.payment-method.spec
// naqshida): har chaqiruv yoziladi, natija `jadval.amal` bo'yicha olinadi.
type Call = {
  table: string;
  op: string;
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
};

function fakeSupabase(responses: Record<string, unknown>, errors: Record<string, string> = {}) {
  const calls: Call[] = [];
  const rpcs: Array<{ fn: string; params: unknown }> = [];
  const builder = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    calls.push(call);
    const result = () => {
      const key = `${table}.${call.op}`;
      const v = responses[key];
      return {
        data: typeof v === 'function' ? (v as (c: Call) => unknown)(call) : (v ?? null),
        error: errors[key] ? { message: errors[key] } : null,
        count: (responses[`${key}.count`] as number | undefined) ?? null,
      };
    };
    const b: Record<string, unknown> = {};
    const chain =
      (name: string) =>
      (...args: unknown[]) => {
        if (name === 'insert' || name === 'update' || name === 'delete') {
          call.op = name;
          call.payload = args[0];
        } else if (['eq', 'in', 'is', 'neq', 'ilike'].includes(name)) {
          call.filters.push([name, String(args[0]), args[1]]);
        }
        return b;
      };
    for (const n of [
      'select',
      'insert',
      'update',
      'delete',
      'eq',
      'in',
      'is',
      'neq',
      'ilike',
      'order',
      'limit',
      'range',
    ])
      b[n] = chain(n);
    b.maybeSingle = async () => result();
    b.single = async () => result();
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    return b;
  };
  const admin = {
    from: (t: string) => builder(t),
    rpc: async (fn: string, params: unknown) => {
      rpcs.push({ fn, params });
      return { data: 0, error: null };
    },
  };
  return { svc: { admin: () => admin } as unknown as SupabaseService, calls, rpcs };
}

const C = 'c1';
const partner = (over: Record<string, unknown> = {}) => ({
  id: 'p-doc',
  type: 'doctor',
  name: 'Dr Aliyev',
  specialty: 'Kardiolog',
  workplace: null,
  phone: '+998901112233',
  phone2: null,
  commission_percent: 10,
  notes: null,
  is_archived: false,
  ...over,
});
const AGENT = partner({ id: 'p-agt', type: 'agent', name: 'Agent Vali', commission_percent: 5 });

const noCashier = {} as CashierService;
const writes = (calls: Call[]) =>
  calls.filter((c) => c.op !== 'select').map((c) => `${c.table}.${c.op}`);

describe('ReferralAgentsService.resolveForAdmit', () => {
  it("o'zi kelgan bemor — null (insert'ga yangi ustun qo'shilmaydi)", async () => {
    const { svc } = fakeSupabase({});
    const r = await new ReferralAgentsService(svc, noCashier).resolveForAdmit(C, {
      admission_channel: 'self',
    });
    expect(r).toBeNull();
  });

  it('foiz sherik kartasidan olinadi (brauzerdagi qiymat emas)', async () => {
    const { svc } = fakeSupabase({ 'referral_partners.select': [partner(), AGENT] });
    const r = await new ReferralAgentsService(svc, noCashier).resolveForAdmit(C, {
      admission_channel: 'referral',
      referring_doctor_id: 'p-doc',
      agent_id: 'p-agt',
    });
    expect(r).toEqual({
      admission_channel: 'referral',
      referring_doctor_id: 'p-doc',
      referring_doctor_percent: 10,
      agent_id: 'p-agt',
      agent_percent: 5,
    });
  });

  it("yo'llanma tanlangan, lekin hech kim tanlanmagan — rad", async () => {
    const { svc } = fakeSupabase({});
    await expect(
      new ReferralAgentsService(svc, noCashier).resolveForAdmit(C, {
        admission_channel: 'referral',
      }),
    ).rejects.toThrow(/shifokor yoki agentni tanlang/);
  });

  it("agent shifokor o'rnida, arxivlangan yoki foizlar > 100% — rad", async () => {
    const cases: Array<[Record<string, unknown>[], Record<string, string>, RegExp]> = [
      [[AGENT], { referring_doctor_id: 'p-agt' }, /agent sifatida yozilgan/],
      [[partner({ is_archived: true })], { referring_doctor_id: 'p-doc' }, /arxivlangan/],
      [
        [partner({ commission_percent: 70 }), partner({ ...AGENT, commission_percent: 40 })],
        { referring_doctor_id: 'p-doc', agent_id: 'p-agt' },
        /100%/,
      ],
    ];
    for (const [rows, ids, re] of cases) {
      const { svc } = fakeSupabase({ 'referral_partners.select': rows });
      await expect(
        new ReferralAgentsService(svc, noCashier).resolveForAdmit(C, {
          admission_channel: 'referral',
          ...ids,
        }),
      ).rejects.toThrow(re);
    }
  });
});

describe('ReferralAgentsService.createPartner', () => {
  it("qabulxona qo'shgan sherik foizi 0 (foizni faqat admin belgilaydi)", async () => {
    const { svc, calls } = fakeSupabase({
      'referral_partners.select': [],
      'referral_partners.insert': partner({ commission_percent: 0 }),
    });
    await new ReferralAgentsService(svc, noCashier).createPartner(C, 'u1', 'receptionist', {
      type: 'doctor',
      name: 'Dr Aliyev',
      commission_percent: 30,
    });
    const ins = calls.find((c) => c.op === 'insert')!.payload as Record<string, unknown>;
    expect(ins.commission_percent).toBe(0);
  });

  it('admin foizni belgilaydi; bir xil F.I.O. + telefon — takror', async () => {
    const ok = fakeSupabase({
      'referral_partners.select': [],
      'referral_partners.insert': partner(),
    });
    await new ReferralAgentsService(ok.svc, noCashier).createPartner(C, 'u1', 'clinic_admin', {
      type: 'doctor',
      name: 'Dr Aliyev',
      commission_percent: 12.5,
    });
    const ins = ok.calls.find((c) => c.op === 'insert')!.payload as Record<string, unknown>;
    expect(ins.commission_percent).toBe(12.5);

    const dup = fakeSupabase({
      'referral_partners.select': [{ id: 'p-doc', name: 'Dr Aliyev', phone: '+998 90 111-22-33' }],
    });
    await expect(
      new ReferralAgentsService(dup.svc, noCashier).createPartner(C, 'u1', 'clinic_admin', {
        type: 'doctor',
        name: 'dr aliyev',
        phone: '998901112233',
      }),
    ).rejects.toThrow(/ro'yxatda bor/);
    expect(writes(dup.calls)).toEqual([]);
  });
});

describe('ReferralAgentsService.updatePartner — foiz keyin belgilansa', () => {
  it("faqat 0% bilan yotqizilgan (yotgan yoki yaqinda) bemorlarga qo'llanadi", async () => {
    const old = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const { svc, calls, rpcs } = fakeSupabase({
      'referral_partners.update': partner({ commission_percent: 10 }),
      'inpatient_stays.select': [
        // 0% — yotibdi → 10%
        {
          id: 's1',
          status: 'admitted',
          admitted_at: old,
          referring_doctor_percent: 0,
          agent_percent: 0,
        },
        // foizi bor — tegilmaydi (snapshot)
        {
          id: 's2',
          status: 'admitted',
          admitted_at: old,
          referring_doctor_percent: 7,
          agent_percent: 0,
        },
        // 0%, lekin 90 kun oldin chiqib ketgan — tegilmaydi
        {
          id: 's3',
          status: 'discharged',
          admitted_at: old,
          referring_doctor_percent: 0,
          agent_percent: 0,
        },
        // agent 95% — yig'indi 100% dan oshmasin → 5%
        {
          id: 's4',
          status: 'admitted',
          admitted_at: old,
          referring_doctor_percent: null,
          agent_percent: 95,
        },
      ],
    });
    const r = await new ReferralAgentsService(svc, noCashier).updatePartner(C, 'u1', 'p-doc', {
      commission_percent: 10,
    });
    expect(r.applied_stays).toBe(2);
    const ups = calls.filter((c) => c.table === 'inpatient_stays' && c.op === 'update');
    expect(ups.map((u) => [u.filters.find((f) => f[1] === 'id')![2], u.payload])).toEqual([
      ['s1', { referring_doctor_percent: 10 }],
      ['s4', { referring_doctor_percent: 5 }],
    ]);
    expect(rpcs.map((x) => (x.params as { p_stay_id: string }).p_stay_id)).toEqual(['s1', 's4']);
  });

  it('foiz yuborilmasa (faqat telefon) — bemorlarga tegilmaydi', async () => {
    const { svc, calls } = fakeSupabase({ 'referral_partners.update': partner() });
    const r = await new ReferralAgentsService(svc, noCashier).updatePartner(C, 'u1', 'p-doc', {
      phone: '+998901112233',
    });
    expect(r.applied_stays).toBe(0);
    expect(calls.some((c) => c.table === 'inpatient_stays')).toBe(false);
  });
});

describe('ReferralAgentsService.updateStayReferral', () => {
  const stay = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    status: 'admitted',
    admission_channel: 'referral',
    referring_doctor_id: 'p-doc',
    referring_doctor_percent: 8,
    agent_id: null,
    agent_percent: 0,
    ...over,
  });

  it("sherik o'zgarmasa — qabuldagi snapshot foiz saqlanadi; yangisiga kartadagi foiz", async () => {
    const { svc, calls, rpcs } = fakeSupabase({
      'inpatient_stays.select': stay(),
      'referral_partners.select': [partner({ commission_percent: 10 }), AGENT],
      'referral_accruals.select': [],
    });
    await new ReferralAgentsService(svc, noCashier).updateStayReferral(C, 's1', {
      admission_channel: 'referral',
      referring_doctor_id: 'p-doc',
      agent_id: 'p-agt',
    });
    const upd = calls.find((c) => c.table === 'inpatient_stays' && c.op === 'update')!
      .payload as Record<string, unknown>;
    expect(upd).toMatchObject({ referring_doctor_percent: 8, agent_id: 'p-agt', agent_percent: 5 });
    // to'lanmagan ulushlar bekor qilinib, qayta hisoblanadi
    const voidCall = calls.find((c) => c.table === 'referral_accruals' && c.op === 'update')!;
    expect(voidCall.payload).toMatchObject({ status: 'void' });
    expect(voidCall.filters).toContainEqual(['eq', 'status', 'accrued']);
    expect(rpcs.some((r) => r.fn === 'accrue_inpatient_referral_shares')).toBe(true);
  });

  it("admin foizni qo'lda belgilaydi; 'o'zi keldi' — hammasi tozalanadi", async () => {
    const a = fakeSupabase({
      'inpatient_stays.select': stay(),
      'referral_partners.select': [partner()],
      'referral_accruals.select': [],
    });
    await new ReferralAgentsService(a.svc, noCashier).updateStayReferral(C, 's1', {
      admission_channel: 'referral',
      referring_doctor_id: 'p-doc',
      referring_doctor_percent: 15,
    });
    expect(
      a.calls.find((c) => c.table === 'inpatient_stays' && c.op === 'update')!.payload,
    ).toMatchObject({ referring_doctor_percent: 15 });

    const b = fakeSupabase({
      'inpatient_stays.select': stay(),
      'referral_partners.select': [],
      'referral_accruals.select': [],
    });
    await new ReferralAgentsService(b.svc, noCashier).updateStayReferral(C, 's1', {
      admission_channel: 'self',
    });
    expect(
      b.calls.find((c) => c.table === 'inpatient_stays' && c.op === 'update')!.payload,
    ).toEqual({
      admission_channel: 'self',
      referring_doctor_id: null,
      referring_doctor_percent: 0,
      agent_id: null,
      agent_percent: 0,
    });
  });
});

describe('ReferralAgentsService.pay / cancelPayout', () => {
  const accruals = [
    {
      id: 'a1',
      stay_id: 's1',
      partner_id: 'p-agt',
      role: 'agent',
      amount_uzs: 10_000,
      status: 'accrued',
    },
    {
      id: 'a2',
      stay_id: 's1',
      partner_id: 'p-agt',
      role: 'agent',
      amount_uzs: 10_000,
      status: 'accrued',
    },
    {
      id: 'a3',
      stay_id: 's2',
      partner_id: 'p-agt',
      role: 'agent',
      amount_uzs: 6_000,
      status: 'paid',
    },
  ];
  const base = () => ({
    'referral_partners.select': [AGENT],
    'referral_accruals.select': accruals,
    'referral_payouts.insert': { id: 'po1' },
    'referral_accruals.update': (c: Call) =>
      (c.payload as { status: string }).status === 'paid'
        ? [
            { stay_id: 's1', amount_uzs: 10_000 },
            { stay_id: 's1', amount_uzs: 10_000 },
          ]
        : [],
    'expense_categories.select': [
      { id: 'cat1', name_i18n: { 'uz-Latn': "Agent / yo'llanma ulushi" } },
    ],
  });

  it("to'lanmagan ulush statsionar kassasidan xarajat bo'lib yoziladi", async () => {
    const createExpense = vi.fn().mockResolvedValue({ id: 'exp1' });
    const { svc, calls } = fakeSupabase(base());
    const r = await new ReferralAgentsService(svc, {
      createExpense,
    } as unknown as CashierService).pay(C, 'u1', 'p-agt', {
      method: 'cash',
      source: 'cash_drawer',
    });

    expect(r).toMatchObject({ payout_id: 'po1', amount_uzs: 20_000, stays: 1 });
    const exp = createExpense.mock.calls[0]![2] as Record<string, unknown>;
    expect(exp).toMatchObject({
      amount_uzs: 20_000,
      register: 'inpatient',
      payment_method: 'cash',
      source: 'cash_drawer',
      category_id: 'cat1',
    });
    // Hisobotlar izohdagi so'zlarga qaraydi — bular bo'lmasin.
    expect(String(exp.description)).not.toMatch(/qarz|inkasatsiya/i);
    // faqat 'accrued' ulushlar olinadi (to'langani qayta to'lanmaydi)
    const claim = calls.find((c) => c.table === 'referral_accruals' && c.op === 'update')!;
    expect(claim.filters).toContainEqual(['in', 'id', ['a1', 'a2']]);
    expect(claim.filters).toContainEqual(['eq', 'status', 'accrued']);
    expect(calls.find((c) => c.table === 'referral_payouts' && c.op === 'update')!.payload).toEqual(
      { expense_id: 'exp1' },
    );
  });

  it("xarajat yozilmasa (smena yopiq) — ulushlar qaytariladi, to'lov o'chiriladi", async () => {
    const createExpense = vi.fn().mockRejectedValue(new Error('Smena ochilmagan'));
    const { svc, calls } = fakeSupabase(base());
    await expect(
      new ReferralAgentsService(svc, { createExpense } as unknown as CashierService).pay(
        C,
        'u1',
        'p-agt',
        { method: 'cash', source: 'cash_drawer' },
      ),
    ).rejects.toThrow(/Smena ochilmagan/);
    expect(writes(calls)).toEqual([
      'referral_payouts.insert',
      'referral_accruals.update',
      'referral_accruals.update',
      'referral_payouts.delete',
    ]);
    const release = calls.filter((c) => c.table === 'referral_accruals' && c.op === 'update')[1]!;
    expect(release.payload).toEqual({ status: 'accrued', payout_id: null });
  });

  it("to'lanmagan ulush yo'q — hech narsa yozilmaydi", async () => {
    const { svc, calls } = fakeSupabase({
      'referral_partners.select': [AGENT],
      'referral_accruals.select': [accruals[2]],
    });
    await expect(
      new ReferralAgentsService(svc, noCashier).pay(C, 'u1', 'p-agt', {
        method: 'cash',
        source: 'cash_drawer',
      }),
    ).rejects.toThrow(/To'lanadigan ulush yo'q/);
    expect(writes(calls)).toEqual([]);
  });

  it("to'lovni bekor qilish: xarajat bekor, ulushlar yana to'lanmagan", async () => {
    const voidExpense = vi.fn().mockResolvedValue({ ok: true });
    const { svc, calls } = fakeSupabase({
      'referral_payouts.select': { id: 'po1', status: 'paid', expense_id: 'exp1' },
    });
    await new ReferralAgentsService(svc, { voidExpense } as unknown as CashierService).cancelPayout(
      C,
      'u1',
      'po1',
    );
    expect(voidExpense).toHaveBeenCalledWith(C, 'u1', 'exp1');
    expect(writes(calls)).toEqual(['referral_accruals.update', 'referral_payouts.update']);
    expect(calls.find((c) => c.table === 'referral_accruals')!.payload).toEqual({
      status: 'accrued',
      payout_id: null,
    });
  });
});

describe('ReferralAgentsService.assertStayDeletable', () => {
  it("ulushi to'langan bemorni Savatchaga o'chirib bo'lmaydi", async () => {
    const { svc } = fakeSupabase({ 'referral_accruals.select.count': 2 });
    await expect(
      new ReferralAgentsService(svc, noCashier).assertStayDeletable(C, 's1'),
    ).rejects.toThrow(/ulush to'langan/);
    const ok = fakeSupabase({ 'referral_accruals.select.count': 0 });
    await expect(
      new ReferralAgentsService(ok.svc, noCashier).assertStayDeletable(C, 's1'),
    ).resolves.toBeUndefined();
  });
});
