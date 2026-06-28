import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, Users, ListOrdered, Stethoscope, FlaskConical,
  Pill, Bed, Wallet, FileText, BarChart3, Megaphone,
  Settings as SettingsIcon, UserSquare2, Coins, HeartPulse, Star,
  Microscope, CalendarClock, Smile, Landmark, ShoppingCart, Boxes, ShieldCheck, Building2,
} from 'lucide-react';

import type { PermissionKey } from '@clary/schemas';

import { useAuth } from '@/providers/auth-provider';

export interface NavItem {
  to: string;
  icon: typeof Users;
  label: string;
  // Foydalanuvchi shu ruxsatlardan kamida bittasiga ega bo'lsa ko'rinadi.
  // Bo'sh/undefined = doim ko'rinadi.
  requires?: PermissionKey[];
}
export interface NavGroup {
  key: string;
  title: string;
  items: NavItem[];
}

/**
 * Sidebar navigatsiya guruhlari — barqaror `key` bilan, ruxsat bo'yicha filtrlangan,
 * DEFAULT tartibda (appearance tartibi bu yerda QO'LLANILMAYDI). Sidebar va
 * "Ko'rinish" sozlama sahifasi shu yagona manbadan foydalanadi.
 */
export function useNavGroups(): NavGroup[] {
  const { t } = useTranslation();
  const { can, role } = useAuth();
  const isOwner = role === 'clinic_owner' || role === 'clinic_admin';

  return useMemo(() => {
    const allGroups: NavGroup[] = [
      {
        key: 'main',
        title: t('nav.group.main', 'Asosiy'),
        items: [
          { to: '/dashboard', icon: LayoutDashboard, label: t('nav.dashboard'), requires: ['analytics.view_self'] },
          { to: '/reception', icon: Users, label: t('nav.reception'), requires: ['appointments.create', 'patients.create', 'queue.view'] },
          { to: '/queue', icon: ListOrdered, label: t('nav.queue'), requires: ['queue.view'] },
          { to: '/appointment-requests', icon: CalendarClock, label: t('nav.appointmentRequests', 'Navbat so‘rovlari'), requires: ['appointments.view'] },
        ],
      },
      {
        key: 'clinical',
        title: t('nav.group.clinical', 'Klinik'),
        items: [
          { to: '/doctor', icon: UserSquare2, label: t('nav.doctor', 'Shifokor'), requires: ['doctor_view.view'] },
          { to: '/diagnostics', icon: Stethoscope, label: t('nav.diagnostics'), requires: ['diagnostics.view'] },
          { to: '/lab', icon: FlaskConical, label: t('nav.lab'), requires: ['lab.view'] },
          { to: '/lab-workstation', icon: Microscope, label: t('nav.labWorkstation', 'Lab ish stoli'), requires: ['lab.view'] },
          { to: '/pharmacy', icon: Pill, label: t('nav.pharmacy'), requires: ['pharmacy.view'] },
          { to: '/inpatient', icon: Bed, label: t('nav.inpatient'), requires: ['inpatient.view'] },
          { to: '/dental', icon: Smile, label: t('nav.dental', 'Stomatologiya'), requires: ['dental.view'] },
          { to: '/nurse', icon: HeartPulse, label: t('nav.nurse', 'Hamshira'), requires: ['nurse.view_tasks'] },
          { to: '/nurse-requests', icon: HeartPulse, label: t('nav.nurseRequests', 'Uyga so‘rovlar'), requires: ['home_nurse.view'] },
          { to: '/inventory', icon: Boxes, label: t('nav.inventory', 'Inventar'), requires: ['pharmacy.view', 'lab.view'] },
        ],
      },
      {
        key: 'finance',
        title: t('nav.group.finance', 'Moliya'),
        items: [
          { to: '/cashier', icon: Wallet, label: t('nav.cashier'), requires: ['cashier.view'] },
          { to: '/journal', icon: FileText, label: t('nav.journal'), requires: ['audit.view', 'cashier.view'] },
          { to: '/accounting', icon: Landmark, label: t('nav.accounting', 'Buxgalteriya'), requires: ['analytics.view_clinic'] },
          { to: '/procurement', icon: ShoppingCart, label: t('nav.procurement', 'Xaridlar'), requires: ['pharmacy.view'] },
          { to: '/insurance', icon: ShieldCheck, label: t('nav.insurance', 'Sug‘urta'), requires: ['cashier.view'] },
          { to: '/payroll', icon: Coins, label: t('nav.payroll', 'Hisob-kitob'), requires: ['payroll.view_own'] },
        ],
      },
      {
        key: 'insights',
        title: t('nav.group.insights', 'Tahlil'),
        items: [
          { to: '/company', icon: Building2, label: t('nav.company', 'Kompaniya (filiallar)'), requires: ['analytics.view_clinic'] },
          { to: '/analytics', icon: BarChart3, label: t('nav.analytics'), requires: ['analytics.view_self', 'analytics.view_clinic'] },
          { to: '/marketing', icon: Megaphone, label: t('nav.marketing'), requires: ['marketing.view'] },
          { to: '/reviews', icon: Star, label: t('nav.reviews', 'Sharhlar'), requires: ['marketing.view'] },
        ],
      },
      {
        key: 'system',
        title: t('nav.group.system', 'Tizim'),
        items: [
          { to: '/settings', icon: SettingsIcon, label: t('nav.settings'), requires: ['settings.view'] },
        ],
      },
    ];

    return allGroups
      .map((g) => ({
        ...g,
        items: g.items.filter((it) => {
          if (isOwner) return true;
          if (!it.requires || it.requires.length === 0) return true;
          return can(...it.requires);
        }),
      }))
      .filter((g) => g.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, can, isOwner]);
}

/**
 * Guruh va qatorlarni saqlangan tartib bo'yicha saralaydi.
 * Tartibда yo'q (noma'lum) elementlar default tartibda oxiriga tushadi
 * (Array.sort barqaror).
 */
export function orderNavGroups(
  groups: NavGroup[],
  groupOrder: string[],
  itemOrder: Record<string, string[]>,
): NavGroup[] {
  const rank = (order: string[], key: string) => {
    const i = order.indexOf(key);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const orderedGroups = [...groups].sort((a, b) => rank(groupOrder, a.key) - rank(groupOrder, b.key));
  return orderedGroups.map((g) => {
    const order = itemOrder[g.key] ?? [];
    return {
      ...g,
      items: [...g.items].sort((a, b) => rank(order, a.to) - rank(order, b.to)),
    };
  });
}
