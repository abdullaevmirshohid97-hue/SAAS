import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { cn } from '@clary/ui-web';
import { LOCALE_LABELS, type SupportedLocale } from '@clary/i18n';

import { useAuth } from '@/providers/auth-provider';

// Qulaylik: til almashtirgich barcha sozlamalar sahifalarida yon panel tepasida.
// Tanlov saqlanadi (main.tsx boshlanishida o'qiladi) — Ko'rinish sahifasidagi
// karta bilan bir xil mexanizm.
const LANGS: SupportedLocale[] = ['uz-Latn', 'uz-Cyrl', 'ru', 'en'];

function SidebarLanguageSwitcher() {
  const { i18n } = useTranslation();
  const change = (code: SupportedLocale) => {
    void i18n.changeLanguage(code);
    try {
      localStorage.setItem('clary.lang', code);
    } catch {
      /* e'tiborsiz */
    }
  };
  return (
    <div className="mb-4 rounded-lg border p-2">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Til / Язык
      </div>
      <div className="flex flex-wrap gap-1">
        {LANGS.map((code) => {
          const active = i18n.language === code;
          return (
            <button
              key={code}
              type="button"
              onClick={() => change(code)}
              className={cn(
                'rounded-md px-2 py-1 text-xs transition-colors',
                active
                  ? 'bg-primary font-semibold text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {LOCALE_LABELS[code]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SettingsLayout() {
  const { role } = useAuth();
  const isOwner = role === 'clinic_owner' || role === 'clinic_admin' || role === 'super_admin';
  const groups = [
    { title: 'Klinika', links: [
      { to: '/settings/clinic', label: 'Umumiy' },
      { to: '/settings/staff',  label: 'Xodimlar (kirish)' },
      { to: '/settings/staff-profiles', label: 'Xodimlar anketasi' },
      { to: '/settings/shift-operators', label: 'Navbatchilar (PIN)' },
      { to: '/settings/shift-schedules', label: 'Smena jadvallari' },
      { to: '/settings/nurse-schedules', label: 'Hamshira navbatchiligi' },
      { to: '/settings/integrations', label: 'Integratsiyalar' },
      { to: '/settings/printer', label: 'Chek printer' },
      { to: '/settings/pharmacy-printer', label: 'Dorixona chek printeri' },
      { to: '/settings/thermal-printers', label: 'Termal printer (silent)' },
      { to: '/settings/subscription', label: 'Obuna' },
      { to: '/settings/journal-layout', label: 'Jurnal ko‘rinishi' },
      { to: '/settings/appearance', label: 'Ko‘rinish (shaxsiy)' },
    ]},
    { title: 'Biznes katalog', links: [
      { to: '/settings/catalog/services', label: 'Xizmatlar' },
      { to: '/settings/catalog/service-categories', label: 'Kategoriyalar' },
      { to: '/settings/catalog/rooms', label: 'Xonalar' },
      { to: '/settings/catalog/diagnostic-types', label: 'Diagnostika' },
      { to: '/settings/catalog/diagnostic-equipment', label: 'Asbob-uskunalar' },
      { to: '/settings/catalog/lab-tests', label: 'Lab testlari' },
      { to: '/settings/catalog/discount-rules', label: 'Chegirmalar' },
      { to: '/settings/catalog/payment-methods', label: 'To’lov turlari' },
      { to: '/settings/insurance', label: 'Sug’urta kompaniyalari' },
      { to: '/settings/catalog/referral-partners', label: 'Yo’llanma sheriklari' },
    ]},
    { title: 'Shablonlar', links: [
      { to: '/settings/catalog/sms-templates', label: 'SMS shablonlari' },
      { to: '/settings/catalog/email-templates', label: 'Email shablonlari' },
      { to: '/settings/catalog/document-templates', label: 'Hujjat shablonlari' },
    ]},
    // Faqat klinika egasi — moliyaviy ma'lumotlarni o'chirish/qaytarish
    ...(isOwner
      ? [{ title: 'Xavfli zona', links: [
          { to: '/settings/trash', label: "Savatcha (o'chirilganlar)" },
          { to: '/settings/data-admin', label: "Ma'lumotlarni o'chirish" },
        ] }]
      : []),
  ];

  return (
    <div className="flex gap-6">
      <aside className="w-64 shrink-0 space-y-6">
        <SidebarLanguageSwitcher />
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
