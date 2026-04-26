import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Button, Input, Card, CardHeader, CardTitle, CardContent } from '@clary/ui-web';

import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { slugify } from '@clary/utils';

export function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    clinicName: '', slug: '', country: 'UZ', timezone: 'Asia/Tashkent',
    defaultLocale: 'uz-Latn', organizationType: 'clinic',
    staffCountBucket: '1-3', primaryColor: '#2563EB',
  });
  const steps = ['Klinika nomi', 'Manzil va til', 'Tashkilot turi', 'Xodimlar soni', 'Brend'];

  async function finish(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post('/api/v1/auth/onboarding', form);
      // Refresh session so JWT carries the new clinic_id and role
      await supabase.auth.refreshSession();
      toast.success('Klinikangiz yaratildi! Demo 14 kunga aktiv.');
      navigate('/dashboard');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  function next() { setStep(Math.min(step + 1, steps.length - 1)); }
  function back() { setStep(Math.max(step - 1, 0)); }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-8 flex gap-2">
        {steps.map((s, i) => (
          <div key={s} className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-primary' : 'bg-muted'}`} />
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{steps[step]}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 0 && (
            <>
              <label className="text-sm font-medium">Klinika nomi</label>
              <Input value={form.clinicName} onChange={(e) => setForm({ ...form, clinicName: e.target.value, slug: slugify(e.target.value) })} placeholder="Klinika NUR" />
              <label className="text-sm font-medium">URL slug</label>
              <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
              <div className="text-xs text-muted-foreground">app.clary.uz/{form.slug}</div>
            </>
          )}
          {step === 1 && (
            <>
              <label className="text-sm font-medium">Mamlakat</label>
              <select className="w-full rounded-md border px-3 py-2" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
                <option value="UZ">O&apos;zbekiston</option>
                <option value="KZ">Qozog&apos;iston</option>
                <option value="KG">Qirg&apos;iziston</option>
                <option value="TJ">Tojikiston</option>
                <option value="RU">Rossiya</option>
              </select>
              <label className="text-sm font-medium">Asosiy til</label>
              <select className="w-full rounded-md border px-3 py-2" value={form.defaultLocale} onChange={(e) => setForm({ ...form, defaultLocale: e.target.value })}>
                <option value="uz-Latn">O&apos;zbekcha (lotin)</option>
                <option value="uz-Cyrl">Ўзбекча (кирилл)</option>
                <option value="ru">Русский</option>
                <option value="kk">Қазақша</option>
                <option value="ky">Кыргызча</option>
                <option value="tg">Тоҷикӣ</option>
                <option value="en">English</option>
              </select>
            </>
          )}
          {step === 2 && (
            <div className="grid grid-cols-2 gap-3">
              {[
                { v: 'clinic', l: 'Klinika' },
                { v: 'hospital', l: 'Kasalxona' },
                { v: 'diagnostic_center', l: 'Diagnostika markazi' },
                { v: 'dental', l: 'Stomatologiya' },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setForm({ ...form, organizationType: o.v })}
                  className={`rounded-lg border p-6 text-left transition ${form.organizationType === o.v ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}
                >
                  <div className="font-semibold">{o.l}</div>
                </button>
              ))}
            </div>
          )}
          {step === 3 && (
            <div className="grid grid-cols-2 gap-3">
              {['1-3', '4-10', '11-50', '50+'].map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setForm({ ...form, staffCountBucket: o })}
                  className={`rounded-lg border p-4 text-left transition ${form.staffCountBucket === o ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}
                >
                  <div className="font-semibold">{o} xodim</div>
                  {o === '1-3' && <div className="text-xs text-muted-foreground">25PRO tavsiya etiladi</div>}
                  {o === '4-10' && <div className="text-xs text-muted-foreground">50PRO tavsiya etiladi</div>}
                  {(o === '11-50' || o === '50+') && <div className="text-xs text-muted-foreground">120PRO tavsiya etiladi</div>}
                </button>
              ))}
            </div>
          )}
          {step === 4 && (
            <>
              <label className="text-sm font-medium">Asosiy rang</label>
              <Input type="color" value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} />
              <p className="text-xs text-muted-foreground">Logo keyinroq Settings→Klinika’dan yuklash mumkin.</p>
            </>
          )}
          <div className="flex justify-between pt-4">
            <Button variant="ghost" onClick={back} disabled={step === 0}>Orqaga</Button>
            {step < steps.length - 1 ? (
              <Button onClick={next}>Keyingi</Button>
            ) : (
              <Button onClick={finish}>Yakunlash</Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
