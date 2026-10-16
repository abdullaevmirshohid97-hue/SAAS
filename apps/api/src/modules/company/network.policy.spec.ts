import { describe, expect, it } from 'vitest';

import { formatNetworkDigest, resolveViewer, toIdList } from './network.policy';

const HQ = 'hq';
const B1 = 'b1';
const B2 = 'b2';

describe('resolveViewer — tarmoq markazi huquqi', () => {
  it('company_owner barcha filiallarni ko‘radi va boshqaradi', () => {
    const v = resolveViewer({
      companyId: 'co',
      activeClinicId: B1,
      jwtRole: 'clinic_admin',
      membership: { role: 'company_owner', accessible_clinic_ids: [] },
      liveBranchIds: [HQ, B1, B2],
    });
    expect(v).toMatchObject({ branchIds: [HQ, B1, B2], canManage: true, isOwner: true });
  });

  it('company_admin boshqaradi, lekin ega emas', () => {
    const v = resolveViewer({
      companyId: 'co',
      activeClinicId: HQ,
      jwtRole: 'clinic_admin',
      membership: { role: 'company_admin', accessible_clinic_ids: [] },
      liveBranchIds: [HQ, B1],
    });
    expect(v).toMatchObject({ canManage: true, isOwner: false });
  });

  it('branch_user — faqat ruxsat etilgan filiallar, faqat ko‘rish', () => {
    const v = resolveViewer({
      companyId: 'co',
      activeClinicId: B1,
      jwtRole: 'clinic_admin',
      membership: { role: 'branch_user', accessible_clinic_ids: [B1, 'arxivdagi'] },
      liveBranchIds: [HQ, B1, B2],
    });
    expect(v).toMatchObject({ branchIds: [B1], canManage: false, isOwner: false });
  });

  it('branch_user [] — tarmoqning hamma filiali', () => {
    const v = resolveViewer({
      companyId: 'co',
      activeClinicId: B1,
      jwtRole: 'doctor',
      membership: { role: 'branch_user', accessible_clinic_ids: [] },
      liveBranchIds: [HQ, B1, B2],
    });
    expect(v?.branchIds).toEqual([HQ, B1, B2]);
  });

  it('tarmoqqa ulangan filialning admini (a’zo emas) butun tarmoqni KO‘RMAYDI', () => {
    const v = resolveViewer({
      companyId: 'co',
      activeClinicId: B1,
      jwtRole: 'clinic_owner',
      membership: null,
      liveBranchIds: [HQ, B1, B2],
    });
    expect(v).toBeNull();
  });

  it('bitta filialli klinika rahbari o‘z klinikasini ko‘radi (eski /company xulqi)', () => {
    const v = resolveViewer({
      companyId: 'co',
      activeClinicId: HQ,
      jwtRole: 'clinic_admin',
      membership: null,
      liveBranchIds: [HQ],
    });
    expect(v).toMatchObject({ branchIds: [HQ], canManage: true });
  });

  it('oddiy xodim (shifokor) a’zo bo‘lmasa — yo‘q', () => {
    expect(
      resolveViewer({
        companyId: 'co',
        activeClinicId: HQ,
        jwtRole: 'doctor',
        membership: null,
        liveBranchIds: [HQ],
      }),
    ).toBeNull();
  });
});

describe('toIdList', () => {
  it('jsonb massividan faqat satrlarni oladi', () => {
    expect(toIdList(['a', 1, null, 'b'])).toEqual(['a', 'b']);
    expect(toIdList(null)).toEqual([]);
    expect(toIdList('a')).toEqual([]);
  });
});

describe('formatNetworkDigest', () => {
  const row = (name: string, received: number, extra: Partial<Record<string, number>> = {}) => ({
    name,
    is_hq: name === 'HQ',
    received_uzs: received,
    pharmacy_uzs: extra.pharmacy ?? 0,
    debt_uzs: extra.debt ?? 0,
    queue_total: extra.queue ?? 0,
    new_patients: extra.newp ?? 0,
    open_shifts: extra.open ?? 0,
    safe_uzs: extra.safe ?? 0,
  });

  it('jami tushum va filiallar tushum (dorixona bilan) bo‘yicha saralanadi', () => {
    const text = formatNetworkDigest('Shifo <Plus>', '2026-10-16', [
      row('Chilonzor', 1_000_000),
      row('HQ', 2_000_000, { pharmacy: 500_000, queue: 30, newp: 4 }),
      row('Yunusobod', 1_200_000, { open: 1, debt: 50_000 }),
    ]);
    // ru-RU guruhlash bo'shlig'i — NBSP; solishtirish uchun oddiy bo'shliqqa
    const plain = text.replace(/[\u00a0\u202f]/g, ' ');
    expect(text).toContain('Shifo &lt;Plus&gt;');
    expect(plain).toContain('4 700 000');
    const iHq = text.indexOf('<b>HQ</b>');
    const iYun = text.indexOf('<b>Yunusobod</b>');
    const iChi = text.indexOf('<b>Chilonzor</b>');
    expect(iHq).toBeLessThan(iYun);
    expect(iYun).toBeLessThan(iChi);
    expect(text).toContain('🥇 <b>HQ</b> (HQ)');
    expect(text).toContain('smena ochiq');
    expect(plain).toContain('qarz 50 000');
  });
});
