import { describe, expect, it } from 'vitest';

import { approvalDecision } from './approval-limits';

describe('approvalDecision — rahbar tasdig‘i (A3)', () => {
  it('limit yo‘q yoki 0 — hamma uchun ruxsat (eski xatti-harakat)', () => {
    expect(approvalDecision(50_000_000, null, 'cashier')).toBe('allow');
    expect(approvalDecision(50_000_000, 0, 'receptionist')).toBe('allow');
  });
  it('limitgacha — kassir ham kiritadi', () => {
    expect(approvalDecision(500_000, 500_000, 'cashier')).toBe('allow');
  });
  it('limitdan katta — kassir/qabulxona emas, faqat rahbar', () => {
    expect(approvalDecision(500_001, 500_000, 'cashier')).toBe('deny');
    expect(approvalDecision(-900_000, 500_000, 'receptionist')).toBe('deny');
    expect(approvalDecision(900_000, 500_000, 'clinic_owner')).toBe('allow');
    expect(approvalDecision(900_000, 500_000, 'clinic_admin')).toBe('allow');
  });
});
