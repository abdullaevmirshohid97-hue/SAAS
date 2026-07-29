import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Heart, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

import { supabase } from '@/lib/supabase';

const schema = z.object({
  email: z.string().email("Noto'g'ri email"),
  password: z.string().min(6, 'Kamida 6 ta belgi'),
});
type Form = z.infer<typeof schema>;

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';
  const [showPass, setShowPass] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: Form) {
    const { error } = await supabase.auth.signInWithPassword(data);
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate(from, { replace: true });
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}${from}` },
    });
    if (error) toast.error(error.message);
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="bg-primary/10 flex h-12 w-12 items-center justify-center rounded-2xl">
            <Heart className="fill-primary text-primary h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold">Xush kelibsiz</h1>
          <p className="text-muted-foreground text-sm">Hisobingizga kiring</p>
        </div>

        {/* Google */}
        <button
          onClick={signInWithGoogle}
          className="hover:bg-muted mb-4 flex w-full items-center justify-center gap-3 rounded-xl border py-2.5 text-sm font-medium transition-colors"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Google bilan kirish
        </button>

        <div className="relative mb-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t" />
          </div>
          <div className="text-muted-foreground bg-background relative flex justify-center px-2 text-xs">
            yoki
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Email</label>
            <input
              {...register('email')}
              type="email"
              autoComplete="email"
              placeholder="sizning@email.com"
              className="bg-background ring-offset-background focus:ring-primary w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition-shadow focus:ring-2"
            />
            {errors.email && (
              <p className="text-destructive mt-1 text-xs">{errors.email.message}</p>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-sm font-medium">Parol</label>
              <Link to="/auth/forgot" className="text-primary text-xs hover:underline">
                Unutdim
              </Link>
            </div>
            <div className="relative">
              <input
                {...register('password')}
                type={showPass ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                className="bg-background ring-offset-background focus:ring-primary w-full rounded-xl border px-4 py-2.5 pr-10 text-sm outline-none transition-shadow focus:ring-2"
              />
              <button
                type="button"
                onClick={() => setShowPass((p) => !p)}
                className="text-muted-foreground hover:text-foreground absolute right-3 top-1/2 -translate-y-1/2"
              >
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password && (
              <p className="text-destructive mt-1 text-xs">{errors.password.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Kirish
          </button>
        </form>

        <p className="text-muted-foreground mt-6 text-center text-sm">
          Hisob yo'qmi?{' '}
          <Link to="/auth/register" className="text-primary font-medium hover:underline">
            Ro'yxatdan o'tish
          </Link>
        </p>
      </div>
    </div>
  );
}
