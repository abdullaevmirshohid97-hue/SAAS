import { useMemo, type ReactNode } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Boxes,
  Clock,
  FileText,
  History,
  Package,
  PackagePlus,
  Pill,
  Receipt,
  Settings,
  Truck,
  Upload,
  Wallet,
} from 'lucide-react';
import { cn } from '@clary/ui-web';

import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import { ClinicsTab } from './clinics';
import {
  PharmacyContext,
  makePharmacyCtx,
  sectionFromSlug,
  type PharmacyCtx,
  type SectionId,
} from './context';
import { DashboardTab } from './dashboard';
import { ImportCatalogTab } from './import-catalog';
import { MedicationsTab } from './medications';
import { PosTab } from './pos';
import { PrescriptionsTab } from './prescriptions';
import { ReceiptTab } from './receipt';
import { ReceiptHistoryTab } from './receipt-history';
import { PharmacySalePage as SaleDetail } from './sale-page';
import { SalesTab } from './sales-history';
import { PharmacySettingsTab } from './settings';
import { ShiftsTab } from './shifts';
import { SuppliersTab } from './suppliers';

// =============================================================================
// Klinika ichidagi dorixona (/pharmacy/*). Bo'limlar URL'da — sahifa yangilansa
// yoki havola yuborilsa o'sha bo'lim ochiladi. Xuddi shu bo'limlar alohida
// "Dorixona" kirishida (/dorixona/*) ham ishlatiladi.
// =============================================================================

export const SECTION_META: Array<{ id: SectionId; label: string; icon: typeof Package }> = [
  { id: 'dashboard', label: 'Dashboard', icon: Package },
  { id: 'pos', label: 'Kassa', icon: Receipt },
  { id: 'sales', label: 'Savdo tarixi', icon: Wallet },
  { id: 'meds', label: 'Dorilar', icon: Pill },
  { id: 'receipt', label: 'Prixod', icon: PackagePlus },
  { id: 'receipt-history', label: 'Prixod tarixi', icon: History },
  { id: 'suppliers', label: 'Firmalar', icon: Truck },
  { id: 'clinics', label: 'Mijoz klinikalar', icon: Boxes },
  { id: 'prescriptions', label: 'Retseptlar', icon: FileText },
  { id: 'shifts', label: 'Kassa smenasi', icon: Clock },
  { id: 'import', label: 'Katalog importi', icon: Upload },
  { id: 'settings', label: 'Sozlamalar', icon: Settings },
];

export function SectionView({ id }: { id: SectionId }) {
  switch (id) {
    case 'pos':
      return <PosTab />;
    case 'sales':
      return <SalesTab />;
    case 'receipt':
      return <ReceiptTab />;
    case 'receipt-history':
      return <ReceiptHistoryTab />;
    case 'meds':
      return <MedicationsTab />;
    case 'suppliers':
      return <SuppliersTab />;
    case 'clinics':
      return <ClinicsTab />;
    case 'prescriptions':
      return <PrescriptionsTab />;
    case 'shifts':
      return <ShiftsTab />;
    case 'import':
      return <ImportCatalogTab />;
    case 'settings':
      return <PharmacySettingsTab />;
    default:
      return <DashboardTab />;
  }
}

const ADMIN_ROLES = ['clinic_owner', 'clinic_admin', 'super_admin'];

/** Klinika foydalanuvchisi uchun dorixona konteksti (huquqlar — klinika roli). */
function useClinicPharmacyCtx(): PharmacyCtx {
  const { role, can } = useAuth();
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ clinic?: { name?: string } }>('/api/v1/auth/me'),
    staleTime: 5 * 60_000,
  });
  const clinicName = me?.clinic?.name ?? 'Dorixona';
  return useMemo(() => {
    const adminRole = ADMIN_ROLES.includes(role);
    // Bosh farmatsevt klinika dorixonasini to'liq boshqaradi; server baribir
    // har amalni o'z ruxsati bo'yicha tekshiradi.
    const isAdmin = adminRole || role === 'pharmacist';
    return makePharmacyCtx({
      mode: 'clinic',
      operator: null,
      isAdmin,
      canReceive: isAdmin || can('pharmacy.receive_stock' as never),
      // Qaytarish serverda egasi/admini uchun
      canReturn: adminRole,
      canDiscount: true,
      canSeeCost: isAdmin,
      clinicName,
    });
  }, [role, can, clinicName]);
}

export function ClinicPharmacyProvider({ children }: { children: ReactNode }) {
  const ctx = useClinicPharmacyCtx();
  return <PharmacyContext.Provider value={ctx}>{children}</PharmacyContext.Provider>;
}

export function PharmacyPage() {
  const { section } = useParams<{ section?: string }>();
  const ctx = useClinicPharmacyCtx();
  const id = sectionFromSlug('clinic', section);
  if (section && !id) return <Navigate to="/pharmacy" replace />;
  const active = id ?? 'dashboard';

  return (
    <PharmacyContext.Provider value={ctx}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dorixona</h1>
            <p className="text-muted-foreground text-sm">
              Kassa, ombor, prixod (Excel), skaner, smena va fiskal chek
            </p>
          </div>
        </div>
        <nav className="bg-muted/30 flex flex-wrap gap-1 rounded-lg border p-1">
          {SECTION_META.map((t) => {
            const Icon = t.icon;
            return (
              <NavLink
                key={t.id}
                to={ctx.path(t.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
                  active === t.id
                    ? 'bg-background shadow-elevation-1'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </NavLink>
            );
          })}
        </nav>
        <SectionView id={active} />
      </div>
    </PharmacyContext.Provider>
  );
}

/** /pharmacy/sale/:saleId — savdo tafsiloti (klinika konteksti bilan). */
export function PharmacySalePage() {
  return (
    <ClinicPharmacyProvider>
      <SaleDetail />
    </ClinicPharmacyProvider>
  );
}
