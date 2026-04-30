import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, X, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

import { nurseApi, type NurseTariff } from '@/lib/api';
import { QK } from '@/lib/query-keys';
import { NurseCard } from '@/components/nurse-card';
import { useAuth } from '@/providers/auth-provider';

const SERVICES = [
  { value: '', label: 'Barchasi' },
  { value: 'injection', label: 'Ukol' },
  { value: 'iv_drip', label: 'Tomchi' },
  { value: 'dressing', label: 'Bog\'lam' },
  { value: 'wound_care', label: 'Yara parvarishi' },
  { value: 'vitals', label: 'Ko\'rsatkichlar' },
  { value: 'elderly_care', label: 'Qariyalar parvarishi' },
  { value: 'post_op_care', label: 'Operatsiyadan keyin' },
  { value: 'pediatric_care', label: 'Pediatrik' },
];

const requestSchema = z.object({
  requester_name: z.string().min(2),
  requester_phone: z.string().min(9),
  address: z.string().min(5),
  address_notes: z.string().optional(),
  preferred_at: z.string().optional(),
  is_urgent: z.boolean().default(false),
  notes: z.string().optional(),
});
type RequestForm = z.infer<typeof requestSchema>;

export function NursesPage() {
  const { session } = useAuth();
  const [service, setService] = useState('');
  const [selected, setSelected] = useState<NurseTariff | null>(null);
  const [done, setDone] = useState(false);

  const { data: tariffs, isLoading } = useQuery({
    queryKey: QK.nurseTariffs({ service: service || undefined }),
    queryFn: () => nurseApi.tariffs(service ? { service } : undefined),
  });

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<RequestForm>({
    resolver: zodResolver(requestSchema),
  });

  const { mutate: sendRequest } = useMutation({
    mutationFn: (data: RequestForm) => nurseApi.request({
      clinic_id: selected!.clinic_id,
      tariff_id: selected!.id,
      service: selected!.service,
      ...data,
    }),
    onSuccess: () => { setDone(true); reset(); setSelected(null); },
    onError: (err: Error) => toast.error(err.message),
  });

  if (done) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center flex flex-col items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-green-100 dark:bg-green-950">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold">So'rov yuborildi!</h2>
        <p className="text-muted-foreground text-sm">Klinika siz bilan tez orada bog'lanadi.</p>
        <button
          onClick={() => setDone(false)}
          className="px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          Yangi so'rov
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Uyga hamshira</h1>
        <p className="text-muted-foreground text-sm">Uyingizga malakali hamshira buyurtma qiling</p>
      </div>

      {/* Service filter */}
      <div className="flex flex-wrap gap-2 mb-6">
        {SERVICES.map((s) => (
          <button
            key={s.value}
            onClick={() => setService(s.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              service === s.value ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Tariffs grid */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !tariffs || tariffs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">Xizmat topilmadi</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tariffs.map((t) => (
            <NurseCard key={t.id} tariff={t} onSelect={setSelected} />
          ))}
        </div>
      )}

      {/* Request modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-background shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold">Buyurtma berish</h3>
              <button onClick={() => setSelected(null)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>

            {!session ? (
              <div className="p-6 text-center">
                <p className="text-sm text-muted-foreground mb-4">Buyurtma berish uchun avval tizimga kiring</p>
                <a href="/auth/login" className="inline-flex px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold">
                  Kirish
                </a>
              </div>
            ) : (
              <form onSubmit={handleSubmit((d) => sendRequest(d))} className="p-4 flex flex-col gap-3">
                {[
                  { name: 'requester_name' as const, label: 'To\'liq ism', placeholder: 'Ism Familiya', type: 'text' },
                  { name: 'requester_phone' as const, label: 'Telefon', placeholder: '+998 90 000 00 00', type: 'tel' },
                  { name: 'address' as const, label: 'Manzil', placeholder: 'Ko\'cha, uy, xonadon', type: 'text' },
                ].map((f) => (
                  <div key={f.name}>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">{f.label}</label>
                    <input
                      {...register(f.name)}
                      type={f.type}
                      placeholder={f.placeholder}
                      className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                    />
                    {errors[f.name] && <p className="mt-0.5 text-xs text-destructive">{errors[f.name]?.message}</p>}
                  </div>
                ))}

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Qulay vaqt (ixtiyoriy)</label>
                  <input
                    {...register('preferred_at')}
                    type="datetime-local"
                    className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input {...register('is_urgent')} type="checkbox" className="h-4 w-4 rounded border accent-primary" />
                  <span className="text-sm">Tezkor (qo'shimcha to'lov)</span>
                </label>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 mt-1"
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  So'rov yuborish
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
