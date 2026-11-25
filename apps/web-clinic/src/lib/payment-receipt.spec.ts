import { beforeEach, describe, expect, it } from 'vitest';

// Node muhitida localStorage yo'q — oddiy xotira shimi.
const store = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

const { paymentReceiptContent, paymentReceiptHtml, receiptNo } = await import('./print-receipt');
const { layoutThermalContent } = await import('./receipt-layout');

const data = {
  clinicName: 'MAGNUS',
  ticketNo: 'A-17',
  date: '25.11.2026 10:00',
  patientName: 'Karimov A.',
  items: [
    { name: 'UZI qorin', qty: 1, amount: 150000 },
    { name: 'Qon tahlili', qty: 2, amount: 80000 },
  ],
  totalUzs: 230000,
  paidUzs: 200000,
  debtUzs: 30000,
  paymentMethod: 'Naqd',
  transactionId: '7c421648-5a2e-47bd-8ec1-8b30ac717e11',
  doctorName: 'Soliev D.',
  cashierName: 'Azamat S.',
};

describe('yagona to‘lov cheki modeli', () => {
  beforeEach(() => store.clear());

  it('chek raqami — tranzaksiya ID boshidan 8 belgi', () => {
    expect(receiptNo(data.transactionId)).toBe('7C421648');
    expect(receiptNo('')).toBe('');
  });

  it('HTML: klinika, navbat, xizmatlar, jami va qarz bloki', () => {
    const html = paymentReceiptHtml(data);
    expect(html).toContain('MAGNUS');
    expect(html).toContain('№ 7C421648');
    expect(html).toContain('class="ticket"');
    expect(html).toContain('2 × ');
    expect(html).toContain('class="total"');
    expect(html).toContain('QARZ:');
  });

  it('matn: HTML bilan bir xil ma’lumot — to‘lov usuli jami OSTIDA', () => {
    const c = paymentReceiptContent(data);
    expect(c.header).toBe('MAGNUS');
    expect(c.title).toContain('№ 7C421648');
    expect(c.items).toHaveLength(2);
    expect(c.debt_uzs).toBe(30000);
    const out = layoutThermalContent(c, '80mm');
    const texts = (out.lines ?? []).map((l) => l.text);
    const jami = texts.findIndex((t) => t.startsWith('JAMI'));
    const usul = texts.findIndex((t) => t.startsWith("To'lov usuli"));
    expect(jami).toBeGreaterThan(-1);
    expect(usul).toBeGreaterThan(jami);
  });

  it('xodim qatorlari sozlamaga bo‘ysunadi (avval matnli chekda yo‘q edi)', () => {
    const on = paymentReceiptContent(data, { show_doctor: true, show_cashier: true });
    const off = paymentReceiptContent(data, { show_doctor: false, show_cashier: false });
    const has = (c: typeof on, s: string) => (c.lines ?? []).some((l) => l.text.includes(s));
    expect(has(on, 'Soliev')).toBe(true);
    expect(has(on, 'Azamat')).toBe(true);
    expect(has(off, 'Soliev')).toBe(false);
    expect(has(off, 'Azamat')).toBe(false);
  });

  it('brend nomi bo‘lsa — sarlavha brend, klinika nomi ostida', () => {
    const c = paymentReceiptContent(data, { brand_name: 'MAGNUS CLINIC' });
    expect(c.header).toBe('MAGNUS CLINIC');
    expect(c.subheader).toBe('MAGNUS');
  });

  it('qarz 0 — qarz bloki yo‘q', () => {
    expect(paymentReceiptHtml({ ...data, debtUzs: 0 })).not.toContain('QARZ:');
    expect(paymentReceiptContent({ ...data, debtUzs: 0 }).debt_uzs).toBeUndefined();
  });
});
