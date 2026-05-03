import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import type { CommandItem } from '@clary/ui-web';

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();

  const items: CommandItem[] = useMemo(
    () => [
      // Navigation — Asosiy
      { id: 'go-dashboard', label: t('nav.dashboard'),  group: 'Asosiy', shortcut: 'g d', onSelect: () => navigate('/dashboard') },
      { id: 'go-reception', label: t('nav.reception'),  group: 'Asosiy', shortcut: 'g r', onSelect: () => navigate('/reception') },
      { id: 'go-queue',     label: t('nav.queue'),      group: 'Asosiy', shortcut: 'g q', onSelect: () => navigate('/queue') },

      // Clinical
      { id: 'go-doctor',    label: t('nav.doctor', 'Shifokor'),     group: 'Klinik', onSelect: () => navigate('/doctor') },
      { id: 'go-diag',      label: t('nav.diagnostics'),            group: 'Klinik', onSelect: () => navigate('/diagnostics') },
      { id: 'go-lab',       label: t('nav.lab'),                    group: 'Klinik', onSelect: () => navigate('/lab') },
      { id: 'go-pharmacy',  label: t('nav.pharmacy'),               group: 'Klinik', onSelect: () => navigate('/pharmacy') },
      { id: 'go-inpatient', label: t('nav.inpatient'),              group: 'Klinik', onSelect: () => navigate('/inpatient') },
      { id: 'go-nurse',     label: t('nav.nurse', 'Hamshira'),      group: 'Klinik', onSelect: () => navigate('/nurse') },
      { id: 'go-nurse-req', label: 'Uyga so‘rovlar (hamshira)',     group: 'Klinik', onSelect: () => navigate('/nurse-requests') },

      // Finance
      { id: 'go-cashier',   label: t('nav.cashier'),                group: 'Moliya', onSelect: () => navigate('/cashier') },
      { id: 'go-journal',   label: t('nav.journal'),                group: 'Moliya', onSelect: () => navigate('/journal') },
      { id: 'go-payroll',   label: t('nav.payroll', 'Hisob-kitob'), group: 'Moliya', onSelect: () => navigate('/payroll') },

      // Insights
      { id: 'go-analytics', label: t('nav.analytics'),              group: 'Tahlil', onSelect: () => navigate('/analytics') },
      { id: 'go-marketing', label: t('nav.marketing'),              group: 'Tahlil', onSelect: () => navigate('/marketing') },
      { id: 'go-reviews',   label: t('nav.reviews', 'Sharhlar'),    group: 'Tahlil', onSelect: () => navigate('/reviews') },

      // Settings
      { id: 'go-settings',         label: t('nav.settings'),              group: 'Sozlamalar', onSelect: () => navigate('/settings') },
      { id: 'go-settings-staff',   label: 'Xodimlar',                     group: 'Sozlamalar', onSelect: () => navigate('/settings/staff') },
      { id: 'go-settings-catalog', label: 'Xizmatlar katalogi',           group: 'Sozlamalar', onSelect: () => navigate('/settings/catalog') },
      { id: 'go-settings-web',     label: 'Web profil',                   group: 'Sozlamalar', onSelect: () => navigate('/settings/web-profile') },
      { id: 'go-settings-integ',   label: 'Integratsiyalar',              group: 'Sozlamalar', onSelect: () => navigate('/settings/integrations') },
      { id: 'go-settings-sub',     label: 'Obuna',                        group: 'Sozlamalar', onSelect: () => navigate('/settings/subscription') },
      { id: 'go-settings-audit',   label: 'Audit jurnali',                group: 'Sozlamalar', onSelect: () => navigate('/settings/audit') },

      // Actions
      { id: 'new-patient',     label: 'Yangi bemor qo’shish', group: 'Amallar', onSelect: () => navigate('/reception?new=true') },
      { id: 'new-appointment', label: 'Qabul belgilash',           group: 'Amallar', onSelect: () => navigate('/reception?new=appointment') },
      { id: 'open-shift',      label: 'Smena ochish',              group: 'Amallar', onSelect: () => navigate('/cashier?open=shift') },
      { id: 'open-kiosk',      label: 'Kiosk rejim',               group: 'Amallar', onSelect: () => navigate('/kiosk') },
    ],
    [navigate, t],
  );

  return { open, setOpen, items };
}
