import { createContext, useContext } from 'react';

// =============================================================================
// Dorixona konteksti — bir xil komponentlar ikki joyda ishlaydi:
//   'clinic'    — klinika ichidagi dorixona (/pharmacy/*, klinika menyusi bilan)
//   'workspace' — alohida "Dorixona" kirishi (/dorixona/*, PIN operator bilan)
// Dizayn va funksiyalar bir xil; faqat manzillar va huquq manbai farq qiladi.
// =============================================================================

export type PharmacyMode = 'clinic' | 'workspace';

export type SectionId =
  | 'pos'
  | 'sales'
  | 'receipt'
  | 'receipt-history'
  | 'meds'
  | 'suppliers'
  | 'clinics'
  | 'prescriptions'
  | 'shifts'
  | 'dashboard'
  | 'import'
  | 'settings';

const CLINIC_PATHS: Record<SectionId, string> = {
  pos: 'pos',
  sales: 'sales',
  receipt: 'receipt',
  'receipt-history': 'receipt-history',
  meds: 'meds',
  suppliers: 'suppliers',
  clinics: 'clinics',
  prescriptions: 'prescriptions',
  shifts: 'shifts',
  dashboard: 'dashboard',
  import: 'import',
  settings: 'settings',
};

const WORKSPACE_PATHS: Record<SectionId, string> = {
  pos: 'kassa',
  sales: 'sotuvlar',
  receipt: 'prihod',
  'receipt-history': 'prihod-tarixi',
  meds: 'ombor',
  suppliers: 'firmalar',
  clinics: 'mijozlar',
  prescriptions: 'retseptlar',
  shifts: 'smenalar',
  dashboard: 'hisobot',
  import: 'import',
  settings: 'sozlamalar',
};

export function sectionSlug(mode: PharmacyMode, id: SectionId): string {
  return (mode === 'workspace' ? WORKSPACE_PATHS : CLINIC_PATHS)[id];
}

export function sectionFromSlug(mode: PharmacyMode, slug: string | undefined): SectionId | null {
  const map = mode === 'workspace' ? WORKSPACE_PATHS : CLINIC_PATHS;
  const hit = (Object.keys(map) as SectionId[]).find((k) => map[k] === slug);
  return hit ?? null;
}

export interface PharmacyOperatorInfo {
  id: string;
  full_name: string;
  role: 'admin' | 'cashier';
  register_no: number | null;
  can_return: boolean;
  can_receive: boolean;
  can_discount: boolean;
}

export interface PharmacyCtx {
  mode: PharmacyMode;
  base: string;
  path: (id: SectionId) => string;
  salePath: (saleId: string) => string;
  operator: PharmacyOperatorInfo | null;
  /** Narx, bekor qilish, sozlamalar. */
  isAdmin: boolean;
  canReceive: boolean;
  canReturn: boolean;
  canDiscount: boolean;
  /** Kassir tannarx/foydani ko'rmaydi. */
  canSeeCost: boolean;
  clinicName: string;
}

export function makePharmacyCtx(p: {
  mode: PharmacyMode;
  operator: PharmacyOperatorInfo | null;
  isAdmin: boolean;
  canReceive: boolean;
  canReturn: boolean;
  canDiscount: boolean;
  canSeeCost: boolean;
  clinicName: string;
}): PharmacyCtx {
  const base = p.mode === 'workspace' ? '/dorixona' : '/pharmacy';
  return {
    ...p,
    base,
    path: (id) => `${base}/${sectionSlug(p.mode, id)}`,
    salePath: (saleId) =>
      p.mode === 'workspace' ? `${base}/sotuvlar/${saleId}` : `${base}/sale/${saleId}`,
  };
}

export const PharmacyContext = createContext<PharmacyCtx>(
  makePharmacyCtx({
    mode: 'clinic',
    operator: null,
    isAdmin: false,
    canReceive: false,
    canReturn: false,
    canDiscount: true,
    canSeeCost: false,
    clinicName: 'Dorixona',
  }),
);

export function usePharmacy(): PharmacyCtx {
  return useContext(PharmacyContext);
}
