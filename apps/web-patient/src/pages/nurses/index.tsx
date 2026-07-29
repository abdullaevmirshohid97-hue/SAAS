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
  { value: 'dressing', label: "Bog'lam" },
  { value: 'wound_care', label: 'Yara parvarishi' },
  { value: 'vitals', label: "Ko'rsatkichlar" },
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

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RequestForm>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(requestSchema) as any,
  });

  const { mutate: sendRequest } = useMutation({
    mutationFn: (data: RequestForm) =>
      nurseApi.request({
        clinic_id: selected!.clinic_id,
        tariff_id: selected!.id,
        service: selected!.service,
        ...data,
      }),
    onSuccess: () => {
      setDone(true);
      reset();
      setSelected(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (done) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-green-100 dark:bg-green-950">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold">So'rov yuborildi!</h2>
        <p className="text-muted-foreground text-sm">Klinika siz bilan tez orada bog'lanadi.</p>
        <button
          onClick={() => setDone(false)}
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl px-6 py-2.5 text-sm font-semibold transition-colors"
        >
          Yangi so'rov
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="mb-1 text-2xl font-bold">Uyga hamshira</h1>
        <p className="text-muted-foreground text-sm">Uyingizga malakali hamshira buyurtma qiling</p>
      </div>

      {/* Service filter */}
      <div className="mb-6 flex flex-wrap gap-2">
        {SERVICES.map((s) => (
          <button
            key={s.value}
            onClick={() => setService(s.value)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              service === s.value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'hover:bg-muted'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Tariffs grid */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
        </div>
      ) : !tariffs || tariffs.length === 0 ? (
        <div className="text-muted-foreground py-12 text-center">Xizmat topilmadi</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tariffs.map((t) => (
            <NurseCard key={t.id} tariff={t} onSelect={setSelected} />
          ))}
        </div>
      )}

      {/* Request modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm sm:items-center">
          <div className="bg-background w-full max-w-md overflow-hidden rounded-2xl shadow-2xl">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold">Buyurtma berish</h3>
              <button
                onClick={() => setSelected(null)}
                className="hover:bg-muted flex h-8 w-8 items-center justify-center rounded-lg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!session ? (
              <div className="p-6 text-center">
                <p className="text-muted-foreground mb-4 text-sm">
                  Buyurtma berish uchun avval tizimga kiring
                </p>
                <a
                  href="/auth/login"
                  className="bg-primary text-primary-foreground inline-flex rounded-xl px-5 py-2.5 text-sm font-semibold"
                >
                  Kirish
                </a>
              </div>
            ) : (
              <form
                onSubmit={handleSubmit((d) => sendRequest(d as RequestForm))}
                className="flex flex-col gap-3 p-4"
              >
                {[
                  {
                    name: 'requester_name' as const,
                    label: "To'liq ism",
                    placeholder: 'Ism Familiya',
                    type: 'text',
                  },
                  {
                    name: 'requester_phone' as const,
                    label: 'Telefon',
                    placeholder: '+998 90 000 00 00',
                    type: 'tel',
                  },
                  {
                    name: 'address' as const,
                    label: 'Manzil',
                    placeholder: "Ko'cha, uy, xonadon",
                    type: 'text',
                  },
                ].map((f) => (
                  <div key={f.name}>
                    <label className="text-muted-foreground mb-1 block text-xs font-medium">
                      {f.label}
                    </label>
                    <input
                      {...register(f.name)}
                      type={f.type}
                      placeholder={f.placeholder}
                      className="bg-background focus:ring-primary w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2"
                    />
                    {errors[f.name] && (
                      <p className="text-destructive mt-0.5 text-xs">{errors[f.name]?.message}</p>
                    )}
                  </div>
                ))}

                <div>
                  <label className="text-muted-foreground mb-1 block text-xs font-medium">
                    Qulay vaqt (ixtiyoriy)
                  </label>
                  <input
                    {...register('preferred_at')}
                    type="datetime-local"
                    className="bg-background focus:ring-primary w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2"
                  />
                </div>

                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    {...register('is_urgent')}
                    type="checkbox"
                    className="accent-primary h-4 w-4 rounded border"
                  />
                  <span className="text-sm">Tezkor (qo'shimcha to'lov)</span>
                </label>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 mt-1 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-colors disabled:opacity-50"
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
