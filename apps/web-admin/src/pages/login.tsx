import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ShieldCheck, Sparkles, Loader2, Mail, Lock, KeyRound } from 'lucide-react';

import {
  Button,
  Input,
  Card,
  CardContent,
  ThemeToggle,
} from '@clary/ui-web';

import { supabase } from '@/main';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showMfa, setShowMfa] = useState(false);
  const [mfaCode, setMfaCode] = useState('');

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast.error(error.message);
        return;
      }
      const role = (data.user.app_metadata as { role?: string }).role;
      if (role !== 'super_admin') {
        await supabase.auth.signOut();
        toast.error('Super admin access required');
        return;
      }

      const { data: factors } = await supabase.auth.mfa.listFactors();
      if (factors?.totp?.length && !showMfa) {
        setShowMfa(true);
        return;
      }
      navigate('/dashboard');
    } finally {
      setLoading(false);
    }
  }

  async function verifyMfa(e: FormEvent): Promise<void> {
    e.preventDefault();
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const factor = factors?.totp?.[0];
    if (!factor) {
      navigate('/dashboard');
      return;
    }
    setLoading(true);
    const challenge = await supabase.auth.mfa.challenge({ factorId: factor.id });
    if (challenge.error || !challenge.data) {
      setLoading(false);
      toast.error(challenge.error?.message ?? 'MFA challenge failed');
      return;
    }
    const verify = await supabase.auth.mfa.verify({
      factorId: factor.id,
      challengeId: challenge.data.id,
      code: mfaCode,
    });
    setLoading(false);
    if (verify.error) {
      toast.error(verify.error.message);
      return;
    }
    navigate('/dashboard');
  }

  return (
    <div className="relative flex min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 bg-mesh-gradient" />

      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden border-r bg-card/40 p-10 lg:flex">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-gradient text-white shadow-elevation-3">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="text-lg font-semibold">Clary</div>
          <span className="ml-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
            Super admin
          </span>
        </div>

        <div className="relative space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border bg-card/80 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Enterprise-grade kontrol
          </div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Platformangizni <span className="bg-brand-gradient bg-clip-text text-transparent">bitta oynadan</span> boshqaring.
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            Barcha klinikalar, shifokorlar, dorixonalar, to&rsquo;lovlar va support xabarlari &mdash; yagona real-time dashboard&rsquo;da.
            Impersonation, audit zanjir, RBAC va 7 tilli CMS &mdash; zero-trust arxitekturasida.
          </p>
          <ul className="grid gap-3 text-sm">
            {[
              'One-click xavfsiz klinikaga kirish (short-lived JWT)',
              'Har bir harakat SHA-256 hash zanjirda auditlanadi',
              'Cross-tenant analitika va real-time monitoring',
              'Landing sayti uchun media library bilan ichki CMS',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span className="text-muted-foreground">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} Clary Health Technologies &middot; Tashkent, UZ
        </div>
      </aside>

      <section className="relative flex w-full flex-col p-6 lg:w-1/2 lg:p-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gradient text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold">Clary Admin</span>
          </div>
          <ThemeToggle compact className="ml-auto" />
        </div>

        <div className="flex flex-1 items-center justify-center">
          <Card className="w-full max-w-md border-0 bg-card/70 shadow-elevation-3 backdrop-blur">
            <CardContent className="space-y-6 p-8">
              <div className="space-y-1.5">
                <h2 className="text-2xl font-semibold tracking-tight">
                  {showMfa ? 'Ikki bosqichli tasdiqlash' : 'Kirish'}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {showMfa
                    ? 'Authenticator ilovasidan 6 xonali kodni kiriting.'
                    : 'Super admin sifatida kiring. MFA yoqilgan bo\u2018lsa keyingi qadamda so\u2018raladi.'}
                </p>
              </div>

              {showMfa ? (
                <form onSubmit={verifyMfa} className="space-y-4">
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9 text-center font-mono tracking-[0.4em]"
                      maxLength={6}
                      placeholder="000000"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                      autoFocus
                      required
                    />
                  </div>
                  <Button className="h-10 w-full" disabled={loading || mfaCode.length !== 6}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Tasdiqlash'}
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowMfa(false);
                      setMfaCode('');
                    }}
                    className="w-full text-xs text-muted-foreground hover:text-foreground"
                  >
                    Boshqa hisob bilan kirish
                  </button>
                </form>
              ) : (
                <form onSubmit={submit} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="email">
                      Email
                    </label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="founder@clary.uz"
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
                      Parol
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
                  <Button className="h-10 w-full" disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Kirish'}
                  </Button>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck className="h-3 w-3" />
                      Sessiya &middot; 15 daq
                    </span>
                    <a href="/forgot-password" className="hover:text-foreground">
                      Parolni unutdingizmi?
                    </a>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="pt-4 text-center text-xs text-muted-foreground">
          Himoyalangan ulanish &middot; TLS 1.3 &middot; WAF &middot; Zero-trust
        </div>
      </section>
    </div>
  );
}
