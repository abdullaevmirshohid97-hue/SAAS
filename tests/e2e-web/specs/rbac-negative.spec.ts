import { test, expect } from '@playwright/test';

// RBAC negative test suite — autentifikatsiyasiz yoki yetarli huquqsiz
// kritik endpointlar 401/403 qaytarishi shart.
//
// Phase 1 (Kun 1): hozir faqat anonymous request testlari (token yo'q).
// Phase 2 (Kun 6 critical-path)'da real foydalanuvchi rollari (receptionist
// vs admin) bilan to'liq RBAC matrix qo'shiladi.

const API = process.env.BASE_URL_API ?? 'http://localhost:4000';

const CRITICAL_ENDPOINTS = [
  // Cashier — refund, depositWithdraw eng xavfli
  { path: '/api/v1/cashier/refund', method: 'POST' as const, body: {} },
  { path: '/api/v1/cashier/deposit-withdraw', method: 'POST' as const, body: {} },
  { path: '/api/v1/cashier/debt-payment', method: 'POST' as const, body: {} },
  { path: '/api/v1/cashier/debtors', method: 'GET' as const },
  { path: '/api/v1/cashier/kpis', method: 'GET' as const },

  // Reception — checkout va payroll-list
  { path: '/api/v1/reception/checkout', method: 'POST' as const, body: {} },
  { path: '/api/v1/doctors/payroll-list', method: 'GET' as const },

  // Inpatient — admit, transfer, discharge
  { path: '/api/v1/inpatient/admit', method: 'POST' as const, body: {} },
  { path: '/api/v1/inpatient/00000000-0000-0000-0000-000000000000/transfer', method: 'PATCH' as const, body: {} },
  { path: '/api/v1/inpatient/00000000-0000-0000-0000-000000000000/discharge', method: 'PATCH' as const, body: {} },
  { path: '/api/v1/inpatient/meal-periods', method: 'POST' as const, body: {} },

  // Thermal printers — settings va print
  { path: '/api/v1/thermal-printers', method: 'POST' as const, body: {} },
  { path: '/api/v1/thermal-printers/print', method: 'POST' as const, body: {} },

  // Journal — clinic layout overrides
  { path: '/api/v1/journal/layout/overrides', method: 'POST' as const, body: {} },
];

for (const ep of CRITICAL_ENDPOINTS) {
  test(`@rbac-negative anonymous ${ep.method} ${ep.path} -> 401/403`, async ({ request }) => {
    const opts: { data?: unknown; headers?: Record<string, string> } = {
      headers: { 'Content-Type': 'application/json' },
    };
    if (ep.body !== undefined) opts.data = ep.body;

    let res;
    if (ep.method === 'POST') res = await request.post(`${API}${ep.path}`, opts);
    else if (ep.method === 'PATCH') res = await request.patch(`${API}${ep.path}`, opts);
    else res = await request.get(`${API}${ep.path}`, opts);

    // 401 (autentifikatsiya yo'q) yoki 403 (taqiqlangan) — ikkalasi ham OK
    // 200/500 — bug (himoyalanmagan endpoint)
    expect([401, 403]).toContain(res.status());
  });
}
