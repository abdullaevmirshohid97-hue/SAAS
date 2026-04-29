import { NavLink, Outlet } from 'react-router-dom';

import { cn } from '@clary/ui-web';

export function SettingsLayout() {
  const groups = [
    { title: 'Klinika', links: [
      { to: '/settings/clinic', label: 'Umumiy' },
      { to: '/settings/staff',  label: 'Xodimlar (kirish)' },
      { to: '/settings/staff-profiles', label: 'Xodimlar anketasi' },
      { to: '/settings/shift-operators', label: 'Navbatchilar (PIN)' },
      { to: '/settings/shift-schedules', label: 'Smena jadvallari' },
      { to: '/settings/integrations', label: 'Integratsiyalar' },
      { to: '/settings/subscription', label: 'Obuna' },
      { to: '/settings/audit', label: 'Audit log' },
    ]},
    { title: 'Biznes katalog', links: [
      { to: '/settings/catalog/services', label: 'Xizmatlar' },
      { to: '/settings/catalog/service-categories', label: 'Kategoriyalar' },
      { to: '/settings/catalog/rooms', label: 'Xonalar' },
      { to: '/settings/catalog/diagnostic-types', label: 'Diagnostika' },
      { to: '/settings/catalog/diagnostic-equipment', label: 'Asbob-uskunalar' },
      { to: '/settings/catalog/lab-tests', label: 'Lab testlari' },
      { to: '/settings/catalog/medications', label: 'Dorilar' },
      { to: '/settings/catalog/discount-rules', label: 'Chegirmalar' },
      { to: '/settings/catalog/payment-methods', label: 'To’lov turlari' },
      { to: '/settings/catalog/insurance-companies', label: 'Sug’urta kompaniyalari' },
      { to: '/settings/catalog/referral-partners', label: 'Yo’llanma sheriklari' },
    ]},
    { title: 'Shablonlar', links: [
      { to: '/settings/catalog/sms-templates', label: 'SMS shablonlari' },
      { to: '/settings/catalog/email-templates', label: 'Email shablonlari' },
      { to: '/settings/catalog/document-templates', label: 'Hujjat shablonlari' },
    ]},
  ];

  return (
    <div className="flex gap-6">
      <aside className="w-64 shrink-0 space-y-6">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</div>
            <nav className="space-y-0.5">
              {g.links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  className={({ isActive }) => cn(
                    'block rounded-md px-3 py-1.5 text-sm',
                    isActive ? 'bg-accent font-semibold' : 'text-muted-foreground hover:bg-accent/60',
                  )}
                >
                  {l.label}
                </NavLink>
              ))}
            </nav>
          </div>
        ))}
      </aside>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
