import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Building2, Globe, Users, Palette, Sparkles, Loader2 } from 'lucide-react';

import { Button, Input, Card, CardContent } from '@clary/ui-web';

import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { slugify } from '@clary/utils';

interface Form {
  clinicName: string;
  slug: string;
  country: string;
  timezone: string;
  defaultLocale: string;
  organizationType: 'clinic' | 'hospital' | 'diagnostic_center' | 'dental' | 'laboratory' | 'pharmacy';
  staffCountBucket: string;
  primaryColor: string;
}

const STEPS = [
  { id: 'clinic', label: 'Klinika', icon: Building2 },
  { id: 'locale', label: 'Til & joy', icon: Globe },
  { id: 'type', label: 'Turi', icon: Users },
  { id: 'team', label: 'Jamoa', icon: Users },
  { id: 'brand', label: 'Brend', icon: Palette },
] as const;

export function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<Form>({
    clinicName: '',
    slug: '',
    country: 'UZ',
    timezone: 'Asia/Tashkent',
    defaultLocale: 'uz-Latn',
    organizationType: 'clinic',
    staffCountBucket: '1-3',
    primaryColor: '#2563EB',
  });

  const canAdvance = (() => {
    if (step === 0) return form.clinicName.trim().length >= 2 && form.slug.length >= 3;
    return true;
  })();

  async function finish(e?: FormEvent) {
    e?.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await api.post('/api/v1/auth/onboarding', form);
      await supabase.auth.refreshSession();
      try {
        // @ts-expect-error PostHog optional
        window.posthog?.capture?.('onboarding_completed', { org_type: form.organizationType });
      } catch {}
      navigate('/dashboard?welcome=1');
    } catch (err) {
      toast.error((err as Error).message);
      setSubmitting(false);
    }
  }

  function next() {
    if (!canAdvance) return;
    if (step === STEPS.length - 1) {
      void finish();
    } else {
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    }
  }
  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }

  const current = STEPS[step]!;
  const Icon = current.icon;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30 p-4 sm:p-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold">Clary</span>
        </div>

        <div className="mb-8">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{current.label}</span>
            <span>{step + 1} / {STEPS.length}</span>
          </div>
          <div className="mt-2 flex gap-1.5">
            {STEPS.map((s, i) => (
              <div
                key={s.id}
                className={`h-1.5 flex-1 rounded-full transition-all ${
                  i <= step ? 'bg-primary' : 'bg-muted'
                }`}
              />
            ))}
          </div>
        </div>

        <Card className="border-0 shadow-lg">
          <CardContent className="space-y-5 p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight">
                  {step === 0 && 'Klinikangiz haqida'}
                  {step === 1 && 'Til va vaqt zonasi'}
                  {step === 2 && 'Tashkilot turi'}
                  {step === 3 && "Jamoa o'lchami"}
                  {step === 4 && 'Brend rangi'}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {step === 0 && 'Bemoringiz ko\'radigan nom va URL'}
                  {step === 1 && 'Sukut bo\'yicha til va mintaqa'}
                  {step === 2 && 'Bizga sizga moslashishga yordam beradi'}
                  {step === 3 && 'Tarif tavsiyasi uchun'}
                  {step === 4 && 'Logo keyinroq qo\'shasiz'}
                </p>
              </div>
            </div>

            {step === 0 && (
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Klinika nomi</label>
                  <Input
                    autoFocus
                    value={form.clinicName}
                    onChange={(e) =>
                      setForm({ ...form, clinicName: e.target.value, slug: slugify(e.target.value) })
                    }
                    placeholder="Klinika NUR"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">URL slug</label>
                  <Input
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    placeholder="klinika-nur"
                  />
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    Bemoringiz quyidagi manzildan kiradi: <span className="font-mono">app.clary.uz/{form.slug || 'sizning-klinika'}</span>
                  </div>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Mamlakat</label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={form.country}
                    onChange={(e) => setForm({ ...form, country: e.target.value })}
                  >
                    <option value="UZ">O'zbekiston</option>
                    <option value="KZ">Qozog'iston</option>
                    <option value="KG">Qirg'iziston</option>
                    <option value="TJ">Tojikiston</option>
                    <option value="RU">Rossiya</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Asosiy til</label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={form.defaultLocale}
                    onChange={(e) => setForm({ ...form, defaultLocale: e.target.value })}
                  >
                    <option value="uz-Latn">O'zbekcha (lotin)</option>
                    <option value="uz-Cyrl">Ўзбекча (кирилл)</option>
                    <option value="ru">Русский</option>
                    <option value="kk">Қазақша</option>
                    <option value="ky">Кыргызча</option>
                    <option value="tg">Тоҷикӣ</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { v: 'clinic' as const, l: 'Klinika', d: 'Umumiy poliklinika' },
                  { v: 'hospital' as const, l: 'Kasalxona', d: 'Statsionar bilan' },
                  { v: 'diagnostic_center' as const, l: 'Diagnostika', d: 'USG, MRI, KT' },
                  { v: 'dental' as const, l: 'Stomatologiya', d: 'Tish davolash' },
                  { v: 'laboratory' as const, l: 'Laboratoriya', d: 'Analizlar' },
                  { v: 'pharmacy' as const, l: 'Dorixona', d: 'POS + ombor' },
                ].map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setForm({ ...form, organizationType: o.v })}
                    className={`rounded-lg border p-4 text-left transition ${
                      form.organizationType === o.v ? 'border-primary bg-primary/5' : 'hover:bg-accent'
                    }`}
                  >
                    <div className="font-semibold">{o.l}</div>
                    <div className="text-xs text-muted-foreground">{o.d}</div>
                  </button>
                ))}
              </div>
            )}

            {step === 3 && (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { v: '1-3', l: '1-3 xodim', plan: '25PRO tavsiya' },
                  { v: '4-10', l: '4-10 xodim', plan: '50PRO tavsiya' },
                  { v: '11-50', l: '11-50 xodim', plan: '120PRO tavsiya' },
                  { v: '50+', l: '50+ xodim', plan: 'Enterprise' },
                ].map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setForm({ ...form, staffCountBucket: o.v })}
                    className={`rounded-lg border p-4 text-left transition ${
                      form.staffCountBucket === o.v ? 'border-primary bg-primary/5' : 'hover:bg-accent'
                    }`}
                  >
                    <div className="font-semibold">{o.l}</div>
                    <div className="text-xs text-muted-foreground">{o.plan}</div>
                  </button>
                ))}
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Asosiy rang</label>
                  <div className="flex items-center gap-3">
                    <Input
                      type="color"
                      value={form.primaryColor}
                      onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                      className="h-12 w-20 cursor-pointer p-1"
                    />
                    <Input
                      value={form.primaryColor}
                      onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                      className="flex-1 font-mono"
                    />
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Ko'rinish
                  </div>
                  <button
                    type="button"
                    className="rounded-md px-4 py-2 text-sm font-semibold text-white"
                    style={{ backgroundColor: form.primaryColor }}
                  >
                    Bemorni qabul qilish
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Logo va boshqa branding'ni keyinroq Settings → Klinika dan sozlaysiz.
                </p>
              </div>
            )}

            <div className="flex justify-between border-t pt-4">
              <Button variant="ghost" onClick={back} disabled={step === 0 || submitting}>
                Orqaga
              </Button>
              <Button onClick={next} disabled={!canAdvance || submitting}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : step === STEPS.length - 1 ? (
                  "Yakunlash 🎉"
                ) : (
                  'Keyingi'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Hammasini keyinroq Settings'dan o'zgartirish mumkin
        </p>
      </div>
    </div>
  );
}
