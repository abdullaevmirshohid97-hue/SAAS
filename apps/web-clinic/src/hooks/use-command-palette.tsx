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
      { id: 'go-dashboard', label: t('nav.dashboard'), group: 'Navigation', shortcut: 'g d', onSelect: () => navigate('/dashboard') },
      { id: 'go-reception', label: t('nav.reception'), group: 'Navigation', shortcut: 'g r', onSelect: () => navigate('/reception') },
      { id: 'go-queue',     label: t('nav.queue'),     group: 'Navigation', shortcut: 'g q', onSelect: () => navigate('/queue') },
      { id: 'go-diag',      label: t('nav.diagnostics'), group: 'Navigation', onSelect: () => navigate('/diagnostics') },
      { id: 'go-lab',       label: t('nav.lab'),       group: 'Navigation', onSelect: () => navigate('/lab') },
      { id: 'go-pharmacy',  label: t('nav.pharmacy'),  group: 'Navigation', onSelect: () => navigate('/pharmacy') },
      { id: 'go-cashier',   label: t('nav.cashier'),   group: 'Navigation', onSelect: () => navigate('/cashier') },
      { id: 'go-settings',  label: t('nav.settings'),  group: 'Navigation', onSelect: () => navigate('/settings') },
      { id: 'new-patient',  label: 'Yangi bemor qo’shish',       group: 'Actions', onSelect: () => navigate('/reception?new=true') },
      { id: 'new-appointment', label: 'Qabul belgilash',              group: 'Actions', onSelect: () => navigate('/reception?new=appointment') },
      { id: 'open-shift',   label: 'Smena ochish',                    group: 'Actions', onSelect: () => navigate('/cashier?open=shift') },
    ],
    [navigate, t],
  );

  return { open, setOpen, items };
}
