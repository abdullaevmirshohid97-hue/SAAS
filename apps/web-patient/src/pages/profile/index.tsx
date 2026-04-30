import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, User, LogOut, Save } from 'lucide-react';
import { toast } from 'sonner';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';
import { useNavigate } from 'react-router-dom';

const schema = z.object({
  full_name: z.string().min(2, 'Kamida 2 ta harf'),
  phone: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
});
type Form = z.infer<typeof schema>;

export function ProfilePage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting, isDirty } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    if (!user) return;
    supabase
      .from('portal_users')
      .select('full_name, phone, city, address')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) reset(data);
        setLoading(false);
      });
  }, [user, reset]);

  async function onSubmit(data: Form) {
    if (!user) return;
    const { error } = await supabase
      .from('portal_users')
      .upsert({ id: user.id, ...data }, { onConflict: 'id' });
    if (error) { toast.error(error.message); return; }
    toast.success('Saqlandi');
  }

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Profilim</h1>

      {/* Avatar */}
      <div className="flex items-center gap-4 p-4 rounded-2xl border bg-card shadow-sm mb-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <User className="h-7 w-7" />
        </div>
        <div>
          <p className="font-semibold">{user?.email}</p>
          <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-950 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
            Faol
          </span>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="rounded-2xl border bg-card shadow-sm p-4 flex flex-col gap-4">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Shaxsiy ma'lumotlar</h2>

        {[
          { name: 'full_name' as const, label: 'To\'liq ism', placeholder: 'Ism Familiya', type: 'text' },
          { name: 'phone' as const, label: 'Telefon', placeholder: '+998 90 000 00 00', type: 'tel' },
          { name: 'city' as const, label: 'Shahar', placeholder: 'Toshkent', type: 'text' },
          { name: 'address' as const, label: 'Manzil', placeholder: 'Ko\'cha, uy...', type: 'text' },
        ].map((f) => (
          <div key={f.name}>
            <label className="block text-sm font-medium mb-1.5">{f.label}</label>
            <input
              {...register(f.name)}
              type={f.type}
              placeholder={f.placeholder}
              className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-primary transition-shadow"
            />
            {errors[f.name] && <p className="mt-1 text-xs text-destructive">{errors[f.name]?.message}</p>}
          </div>
        ))}

        <button
          type="submit"
          disabled={isSubmitting || !isDirty}
          className="flex items-center justify-center gap-2 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Saqlash
        </button>
      </form>

      <button
        onClick={handleSignOut}
        className="mt-4 flex items-center justify-center gap-2 w-full rounded-xl border border-destructive/30 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/5 transition-colors"
      >
        <LogOut className="h-4 w-4" />
        Chiqish
      </button>
    </div>
  );
}
