import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Heart, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

import { supabase } from '@/lib/supabase';

const schema = z.object({
  full_name: z.string().min(2, 'Kamida 2 ta harf'),
  email: z.string().email('Noto\'g\'ri email'),
  password: z.string().min(8, 'Kamida 8 ta belgi'),
  accept: z.boolean().refine((v) => v, 'Shartlarni qabul qiling'),
});
type Form = z.infer<typeof schema>;

export function RegisterPage() {
  const navigate = useNavigate();
  const [showPass, setShowPass] = useState(false);
  const [done, setDone] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { accept: false },
  });

  async function onSubmit(data: Form) {
    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: { full_name: data.full_name, role: 'patient' },
      },
    });
    if (error) { toast.error(error.message); return; }
    setDone(true);
  }

  if (done) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm text-center flex flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-green-100 dark:bg-green-950">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold">Tasdiqlang!</h2>
          <p className="text-muted-foreground text-sm">
            Emailingizga tasdiqlash havolasi yuborildi. Iltimos, emailingizni tekshiring va havolani bosing.
          </p>
          <button
            onClick={() => navigate('/auth/login')}
            className="mt-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Kirish sahifasiga o'tish
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 mb-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
            <Heart className="h-6 w-6 fill-primary text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Hisob yaratish</h1>
          <p className="text-sm text-muted-foreground">Bepul ro'yxatdan o'ting</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">To'liq ism</label>
            <input
              {...register('full_name')}
              type="text"
              autoComplete="name"
              placeholder="Ism Familiya"
              className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-primary transition-shadow"
            />
            {errors.full_name && <p className="mt-1 text-xs text-destructive">{errors.full_name.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Email</label>
            <input
              {...register('email')}
              type="email"
              autoComplete="email"
              placeholder="sizning@email.com"
              className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-primary transition-shadow"
            />
            {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Parol</label>
            <div className="relative">
              <input
                {...register('password')}
                type={showPass ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Kamida 8 ta belgi"
                className="w-full rounded-xl border bg-background px-4 py-2.5 pr-10 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-primary transition-shadow"
              />
              <button
                type="button"
                onClick={() => setShowPass((p) => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password && <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>}
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              {...register('accept')}
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border accent-primary"
            />
            <span className="text-xs text-muted-foreground">
              <Link to="/legal/terms" className="text-primary hover:underline">Foydalanish shartlari</Link> va{' '}
              <Link to="/legal/privacy" className="text-primary hover:underline">Maxfiylik siyosati</Link>ni qabul qilaman
            </span>
          </label>
          {errors.accept && <p className="-mt-2 text-xs text-destructive">{errors.accept.message}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Ro'yxatdan o'tish
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Hisobingiz bormi?{' '}
          <Link to="/auth/login" className="text-primary font-medium hover:underline">Kirish</Link>
        </p>
      </div>
    </div>
  );
}
