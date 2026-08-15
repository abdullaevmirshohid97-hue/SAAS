import { describe, expect, it } from 'vitest';

import { defaultFieldPermissions, hiddenFieldsFor } from '../rbac/permissions';
import { redact } from './field-security.interceptor';

// =============================================================================
// Maydon darajasidagi xavfsizlik — siyosat va tozalash mantiqi
// =============================================================================
// Bu kod HAR BIR javobga tegadi, shuning uchun sinovsiz chiqarilmaydi.
// Ikki narsa tekshiriladi: (1) kim nimani ko'radi, (2) tozalash aynan
// kerakligini olib tashlaydimi va boshqasiga tegmaydimi.

describe('hiddenFieldsFor — kim nimani ko\'radi', () => {
  it('shifokor tashxisni ko\'radi, PINFL ni ko\'rmaydi', () => {
    const hidden = hiddenFieldsFor('doctor', null);
    expect(hidden).not.toContain('diagnosis_code');
    expect(hidden).not.toContain('diagnosis_text');
    expect(hidden).toContain('pinfl');
  });

  it('qabulxona tashxisni ko\'rmaydi — asosiy talab', () => {
    const hidden = hiddenFieldsFor('receptionist', null);
    expect(hidden).toContain('diagnosis_code');
    expect(hidden).toContain('diagnosis_text');
  });

  it('kassir tannarxni ko\'radi, tashxisni ko\'rmaydi', () => {
    const hidden = hiddenFieldsFor('cashier', null);
    expect(hidden).not.toContain('cost_uzs');
    expect(hidden).toContain('diagnosis_code');
  });

  it('maosh maydonlari faqat rahbariyatga ochiq', () => {
    expect(hiddenFieldsFor('doctor', null)).toContain('salary_fixed_uzs');
    expect(hiddenFieldsFor('clinic_admin', null)).not.toContain('salary_fixed_uzs');
  });

  it('aniq ruxsat rol standartini bekor qiladi', () => {
    const perms = { ...defaultFieldPermissions('receptionist'), 'field.clinical.diagnosis_code': true };
    const hidden = hiddenFieldsFor('receptionist', perms);
    expect(hidden).not.toContain('diagnosis_code');
    // Boshqa maydon ochilib ketmasligi kerak
    expect(hidden).toContain('pinfl');
  });

  it('noma\'lum rol — hamma himoyalangan maydon yopiq (xavfsiz tomon)', () => {
    const hidden = hiddenFieldsFor('nomalum_rol', null);
    expect(hidden).toContain('diagnosis_code');
    expect(hidden).toContain('pinfl');
    expect(hidden).toContain('cost_uzs');
  });
});

describe('redact — tozalash', () => {
  const hidden = new Set(['pinfl', 'diagnosis_code']);

  it('yopiq maydonni null qiladi va _hidden bayrog\'i qo\'yadi', () => {
    const out = redact({ full_name: 'Ali', pinfl: '31704886210017' }, hidden, 0) as Record<
      string,
      unknown
    >;
    expect(out.full_name).toBe('Ali');
    expect(out.pinfl).toBeNull();
    expect(out.pinfl_hidden).toBe(true);
  });

  it('QORA RO\'YXAT: ro\'yxatda yo\'q maydonlarga TEGMAYDI', () => {
    const row = { id: '1', phone: '+998901234567', total_uzs: 405000, note: 'test' };
    expect(redact(row, hidden, 0)).toEqual(row);
  });

  it('massiv va ichma-ich obyektlarni ham tozalaydi', () => {
    const out = redact(
      [{ patient: { full_name: 'Ali', pinfl: '123' }, diagnosis_code: 'J06.9' }],
      hidden,
      0,
    ) as Array<Record<string, unknown>>;
    const patient = out[0]!.patient as Record<string, unknown>;
    expect(patient.full_name).toBe('Ali');
    expect(patient.pinfl).toBeNull();
    expect(out[0]!.diagnosis_code).toBeNull();
  });

  it('null va oddiy qiymatlarni buzmaydi', () => {
    expect(redact(null, hidden, 0)).toBeNull();
    expect(redact('matn', hidden, 0)).toBe('matn');
    expect(redact(42, hidden, 0)).toBe(42);
  });

  it('Date obyektiga tegmaydi', () => {
    const d = new Date('2026-08-15T00:00:00Z');
    expect(redact({ created_at: d }, hidden, 0)).toEqual({ created_at: d });
  });

  it('yopiq maydon yo\'q bo\'lsa javob o\'zgarmaydi', () => {
    const row = { id: '1', name: 'Test' };
    expect(redact(row, hidden, 0)).toEqual(row);
  });
});
