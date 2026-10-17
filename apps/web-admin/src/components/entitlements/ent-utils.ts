import type { EntitlementsData, EntitlementsPatch } from '@clary/api-client';

// Tarif imkoniyatlari — muharrir uchun yordamchilar. Birlashtirish qoidasi
// bazadagi jsonb_deep_merge bilan bir xil: patch'dagi kalit (null ham) ustun.

export const DEFAULT_ENT: EntitlementsData = {
  plan: null,
  plan_name: null,
  modules: {},
  limits: { max_staff: null, max_devices: null, max_patients: null },
  journal: { history_days: null, allow_edit: true, allow_delete: true, allow_export: true },
  payments: { methods: null },
  roles: { allowed: null, custom_roles: true },
  devices: {
    clients: { web: true, desktop: true, mobile: true, kiosk: true },
    enforce_limit: false,
  },
};

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** base ustiga patch (override) — effektiv ko'rinish (oldindan ko'rish uchun). */
export function applyPatch(base: EntitlementsData, patch: EntitlementsPatch): EntitlementsData {
  const out = clone(base);
  if (patch.modules) out.modules = { ...out.modules, ...patch.modules };
  if (patch.journal) out.journal = { ...out.journal, ...patch.journal };
  if (patch.payments && 'methods' in patch.payments) {
    out.payments = { methods: patch.payments.methods ?? null };
  }
  if (patch.roles) out.roles = { ...out.roles, ...patch.roles } as EntitlementsData['roles'];
  if (patch.devices) {
    out.devices = {
      clients: { ...out.devices.clients, ...(patch.devices.clients ?? {}) },
      enforce_limit: patch.devices.enforce_limit ?? out.devices.enforce_limit,
    };
  }
  if (patch.limits) out.limits = { ...out.limits, ...patch.limits };
  return out;
}

/** To'liq tarif imkoniyatlari → saqlanadigan qism (yopiq modullargina). */
export function planToPatch(e: EntitlementsData): EntitlementsPatch {
  return {
    modules: Object.fromEntries(Object.entries(e.modules).filter(([, v]) => v === false)),
    journal: e.journal,
    payments: { methods: e.payments.methods },
    roles: e.roles,
    devices: e.devices,
  };
}

/** Bo'sh kichik obyektlarni olib tashlaydi (override ixcham saqlansin). */
export function compactPatch(p: EntitlementsPatch): EntitlementsPatch {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v == null || typeof v !== 'object') continue;
    const inner = Object.fromEntries(
      Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined),
    );
    if (k === 'devices' && inner.clients && Object.keys(inner.clients as object).length === 0) {
      delete inner.clients;
    }
    if (Object.keys(inner).length > 0) out[k] = inner;
  }
  return out as EntitlementsPatch;
}

export function countOverrides(p: EntitlementsPatch | null | undefined): number {
  if (!p) return 0;
  let n = 0;
  n += Object.keys(p.modules ?? {}).length;
  n += Object.keys(p.journal ?? {}).length;
  n += p.payments && 'methods' in p.payments ? 1 : 0;
  n += Object.keys(p.roles ?? {}).length;
  n += Object.keys(p.devices?.clients ?? {}).length + (p.devices?.enforce_limit != null ? 1 : 0);
  n += Object.keys(p.limits ?? {}).length;
  return n;
}

export const fmtUzs = (n: number | null | undefined) =>
  n == null ? '—' : `${Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ')} so‘m`;

export const limitText = (n: number | null | undefined) => (n == null ? 'Cheksiz' : String(n));
