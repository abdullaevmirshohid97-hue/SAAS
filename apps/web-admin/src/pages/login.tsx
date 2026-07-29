import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ShieldCheck, Loader2, Mail, Lock, KeyRound } from 'lucide-react';

import { Button, Input, Card, CardContent, ClaryLogo, ThemeToggle } from '@clary/ui-web';

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
    <div className="bg-background relative flex min-h-screen overflow-hidden">
      <div className="bg-mesh-gradient pointer-events-none absolute inset-0" />

      <aside className="bg-card/40 relative hidden w-1/2 flex-col justify-between overflow-hidden border-r p-10 lg:flex">
        <div className="flex items-center gap-2">
          <ClaryLogo variant="full" size="lg" className="shadow-elevation-3 rounded-lg" />
          <span className="border-primary/30 bg-primary/10 text-primary ml-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
            Super admin
          </span>
        </div>

        <div className="relative space-y-6">
          <div className="bg-card/80 text-muted-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium backdrop-blur">
            <ShieldCheck className="text-primary h-3.5 w-3.5" />
            Enterprise-grade kontrol
          </div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Platformangizni{' '}
            <span className="bg-brand-gradient bg-clip-text text-transparent">bitta oynadan</span>{' '}
            boshqaring.
          </h1>
          <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
            Barcha klinikalar, shifokorlar, dorixonalar, to&rsquo;lovlar va support xabarlari
            &mdash; yagona real-time dashboard&rsquo;da. Impersonation, audit zanjir, RBAC va 7
            tilli CMS &mdash; zero-trust arxitekturasida.
          </p>
          <ul className="grid gap-3 text-sm">
            {[
              'One-click xavfsiz klinikaga kirish (short-lived JWT)',
              'Har bir harakat SHA-256 hash zanjirda auditlanadi',
              'Cross-tenant analitika va real-time monitoring',
              'Landing sayti uchun media library bilan ichki CMS',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <div className="bg-primary mt-1 h-1.5 w-1.5 shrink-0 rounded-full" />
                <span className="text-muted-foreground">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="text-muted-foreground text-xs">
          &copy; {new Date().getFullYear()} Clary Health Technologies &middot; Tashkent, UZ
        </div>
      </aside>

      <section className="relative flex w-full flex-col p-6 lg:w-1/2 lg:p-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 lg:hidden">
            <ClaryLogo variant="full" size="md" className="rounded-lg" />
            <span className="text-muted-foreground text-sm font-semibold">Admin</span>
          </div>
          <ThemeToggle compact className="ml-auto" />
        </div>

        <div className="flex flex-1 items-center justify-center">
          <Card className="bg-card/70 shadow-elevation-3 w-full max-w-md border-0 backdrop-blur">
            <CardContent className="space-y-6 p-8">
              <div className="space-y-1.5">
                <h2 className="text-2xl font-semibold tracking-tight">
                  {showMfa ? 'Ikki bosqichli tasdiqlash' : 'Kirish'}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {showMfa
                    ? 'Authenticator ilovasidan 6 xonali kodni kiriting.'
                    : 'Super admin sifatida kiring. MFA yoqilgan bo\u2018lsa keyingi qadamda so\u2018raladi.'}
                </p>
              </div>

              {showMfa ? (
                <form onSubmit={verifyMfa} className="space-y-4">
                  <div className="relative">
                    <KeyRound className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
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
                    className="text-muted-foreground hover:text-foreground w-full text-xs"
                  >
                    Boshqa hisob bilan kirish
                  </button>
                </form>
              ) : (
                <form onSubmit={submit} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-muted-foreground text-xs font-medium" htmlFor="email">
                      Email
                    </label>
                    <div className="relative">
                      <Mail className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
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
                    <label className="text-muted-foreground text-xs font-medium" htmlFor="password">
                      Parol
                    </label>
                    <div className="relative">
                      <Lock className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
                      <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
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

                  <div className="text-muted-foreground flex items-center justify-between text-xs">
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

        <div className="text-muted-foreground pt-4 text-center text-xs">
          Himoyalangan ulanish &middot; TLS 1.3 &middot; WAF &middot; Zero-trust
        </div>
      </section>
    </div>
  );
}
