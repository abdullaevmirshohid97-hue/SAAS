import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Sparkles,
  Loader2,
  Mail,
  Lock,
  Stethoscope,
  ShieldCheck,
  Activity,
  Syringe,
  TestTubes,
  HeartPulse,
  PackageSearch,
} from 'lucide-react';

import {
  Button,
  Input,
  Card,
  CardContent,
  ThemeToggle,
  cn,
} from '@clary/ui-web';

import { supabase } from '@/lib/supabase';

const LOCALES = [
  { code: 'uz-Latn', label: 'O\u2018zbekcha' },
  { code: 'uz-Cyrl', label: '\u040E\u0437\u0431\u0435\u043A\u0447\u0430' },
  { code: 'ru', label: '\u0420\u0443\u0441\u0441\u043A\u0438\u0439' },
  { code: 'en', label: 'English' },
];

const HIGHLIGHTS = [
  { icon: Activity, label: 'Reception POS' },
  { icon: Stethoscope, label: 'Doctor console' },
  { icon: Syringe, label: 'Inpatient care' },
  { icon: TestTubes, label: 'Laboratory' },
  { icon: PackageSearch, label: 'Pharmacy POS' },
  { icon: HeartPulse, label: 'Real-time' },
];

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate('/dashboard');
  }

  async function onGoogle(): Promise<void> {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) toast.error(error.message);
  }

  return (
    <div className="relative flex min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-mesh-gradient" />

      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden border-r bg-card/40 p-10 lg:flex">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-gradient text-white shadow-elevation-3">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="text-lg font-semibold">Clary</div>
          <span className="ml-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
            Klinika
          </span>
        </div>

        <div className="relative max-w-lg space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border bg-card/80 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            CIS data residency &middot; 152-FZ tayyor
          </div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Klinikangizni <span className="bg-brand-gradient bg-clip-text text-transparent">butun jamoa</span> bilan birga boshqaring.
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Qabulxonadan tortib statsionar, labaratoriya, dorixona va analitikagacha &mdash; yagona real-time platforma. Smenaga oid hech narsa yo&rsquo;qolmaydi, chunki har bir harakat audit jurnalida saqlanadi.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {HIGHLIGHTS.map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex flex-col items-start gap-2 rounded-lg border bg-card/70 p-3 text-xs backdrop-blur"
              >
                <Icon className="h-4 w-4 text-primary" />
                <span className="font-medium">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} Clary &middot; Tashkent &middot; Toshkent
        </div>
      </aside>

      <section className="relative flex w-full flex-col p-6 lg:w-1/2 lg:p-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gradient text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold">Clary</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="inline-flex rounded-full border bg-background p-0.5 shadow-elevation-1">
              {LOCALES.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => i18n.changeLanguage(l.code)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                    i18n.language === l.code
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <ThemeToggle compact />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <Card className="w-full max-w-md border-0 bg-card/70 shadow-elevation-3 backdrop-blur">
            <CardContent className="space-y-6 p-8">
              <div className="space-y-1.5">
                <h2 className="text-2xl font-semibold tracking-tight">{t('auth.signIn', 'Kirish')}</h2>
                <p className="text-sm text-muted-foreground">
                  {t('auth.subtitle', 'Klinika hisobingiz bilan kiring yoki Google orqali davom eting.')}
                </p>
              </div>

              <Button variant="outline" className="h-10 w-full gap-2" onClick={onGoogle}>
                <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
                  <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.4-1.7 4-5.5 4-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.9 3.6 14.7 2.7 12 2.7 6.9 2.7 2.7 6.9 2.7 12S6.9 21.3 12 21.3c6.9 0 9.1-4.8 9.1-8.2 0-.6-.1-1-.1-1.5H12z" />
                </svg>
                {t('auth.continueWithGoogle', 'Google orqali davom etish')}
              </Button>

              <div className="relative flex items-center gap-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                {t('common.or', 'yoki')}
                <div className="h-px flex-1 bg-border" />
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="email">
                    {t('auth.email', 'Email')}
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="admin@klinika.uz"
                      className="pl-9"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="password">
                    {t('auth.password', 'Parol')}
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
                      className="pl-9"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </div>
                </div>

                <Button type="submit" className="h-10 w-full" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t('auth.signIn', 'Kirish')}
                </Button>
              </form>

              <a
                href="https://clary.uz/demo"
                className="block rounded-md border border-dashed border-primary/40 bg-primary/5 p-3 text-center text-xs font-medium text-primary transition hover:bg-primary/10"
              >
                \u26a1 {t('auth.tryDemo', "1 click bilan demo sinab ko'rish")}
              </a>

              <p className="text-center text-xs text-muted-foreground">
                {t('auth.noAccount', 'Hisobingiz yo\u2018qmi?')}{' '}
                <a href="https://clary.uz/signup" className="font-medium text-primary hover:underline">
                  {t('auth.signup', 'Ro\u2018yxatdan o\u2018ting')}
                </a>
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="pt-4 text-center text-xs text-muted-foreground">
          TLS 1.3 &middot; RLS &middot; SHA-256 audit chain
        </div>
      </section>
    </div>
  );
}
