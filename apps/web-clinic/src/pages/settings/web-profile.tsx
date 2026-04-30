import { useEffect, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Save, Loader2, Globe, Plus, Trash2, Eye, Image, Clock,
  MapPin, Star, BarChart3, ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';

const DAYS = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const ServiceSchema = z.object({
  name: z.string().min(1),
  price_uzs: z.coerce.number().min(0).optional(),
  duration_min: z.coerce.number().min(5).optional(),
  description: z.string().optional(),
});

const ProfileSchema = z.object({
  tagline: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
  banner_url: z.string().url().optional().or(z.literal('')),
  services: z.array(ServiceSchema).default([]),
  specialties: z.string().optional(),
  established_year: z.coerce.number().min(1900).max(2030).optional(),
  geo_lat: z.coerce.number().optional(),
  geo_lng: z.coerce.number().optional(),
  is_published: z.boolean().default(false),
});
type ProfileForm = z.infer<typeof ProfileSchema>;

export function WebProfilePage() {
  const { clinicId } = useAuth();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'info' | 'services' | 'hours' | 'location' | 'analytics'>('info');
  const [workingHours, setWorkingHours] = useState<Record<string, { open: string; close: string; closed: boolean }>>(
    Object.fromEntries(DAY_KEYS.map((k) => [k, { open: '09:00', close: '18:00', closed: false }])),
  );

  const { data: profile, isLoading } = useQuery({
    queryKey: ['clinic-web-profile', clinicId],
    queryFn: async () => {
      if (!clinicId) return null;
      const { data } = await supabase
        .from('clinic_web_profiles')
        .select('*')
        .eq('clinic_id', clinicId)
        .maybeSingle();
      return data;
    },
    enabled: !!clinicId,
  });

  const { data: analytics } = useQuery({
    queryKey: ['clinic-analytics', clinicId],
    queryFn: async () => {
      if (!clinicId) return null;
      // Direct Supabase queries for analytics
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const [{ count: viewsWeek }, { data: rating }] = await Promise.all([
        supabase.from('clinic_profile_views').select('*', { count: 'exact', head: true })
          .eq('clinic_id', clinicId).gte('viewed_at', weekAgo),
        supabase.from('clinic_rating_summary').select('avg_rating,review_count').eq('clinic_id', clinicId).maybeSingle(),
      ]);
      return { views_week: viewsWeek ?? 0, avg_rating: rating?.avg_rating, review_count: rating?.review_count ?? 0 };
    },
    enabled: !!clinicId,
  });

  const { register, handleSubmit, control, reset, watch, formState: { errors, isDirty, isSubmitting } } = useForm<ProfileForm>({
    resolver: zodResolver(ProfileSchema),
    defaultValues: { services: [], is_published: false },
  });

  const { fields: services, append, remove } = useFieldArray({ control, name: 'services' });

  useEffect(() => {
    if (profile) {
      reset({
        tagline: profile.tagline ?? '',
        description: profile.description ?? '',
        banner_url: profile.banner_url ?? '',
        services: profile.services ?? [],
        specialties: (profile.specialties ?? []).join(', '),
        established_year: profile.established_year ?? undefined,
        geo_lat: profile.geo_lat ?? undefined,
        geo_lng: profile.geo_lng ?? undefined,
        is_published: profile.is_published ?? false,
      });
      if (profile.working_hours) setWorkingHours(profile.working_hours);
    }
  }, [profile, reset]);

  const { mutate: save } = useMutation({
    mutationFn: async (data: ProfileForm) => {
      if (!clinicId) return;
      const payload = {
        clinic_id: clinicId,
        tagline: data.tagline || null,
        description: data.description || null,
        banner_url: data.banner_url || null,
        services: data.services,
        specialties: data.specialties ? data.specialties.split(',').map((s) => s.trim()).filter(Boolean) : [],
        established_year: data.established_year ?? null,
        geo_lat: data.geo_lat ?? null,
        geo_lng: data.geo_lng ?? null,
        working_hours: workingHours,
        is_published: data.is_published,
      };
      const { error } = await supabase
        .from('clinic_web_profiles')
        .upsert(payload, { onConflict: 'clinic_id' });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success('Profil saqlandi!');
      qc.invalidateQueries({ queryKey: ['clinic-web-profile', clinicId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const clinicSlug = (profile as any)?.portal_slug;
  const portalUrl = clinicSlug
    ? `https://my.clary.uz/clinics/${clinicSlug}`
    : null;

  const tabs = [
    { key: 'info', label: 'Asosiy', icon: Globe },
    { key: 'services', label: 'Xizmatlar', icon: Plus },
    { key: 'hours', label: 'Ish soati', icon: Clock },
    { key: 'location', label: 'Lokatsiya', icon: MapPin },
    { key: 'analytics', label: 'Statistika', icon: BarChart3 },
  ] as const;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Web Profil</h2>
          <p className="text-sm text-muted-foreground">Axoli portalidagi klinika sahifangizni boshqaring</p>
        </div>
        <div className="flex items-center gap-2">
          {portalUrl && (
            <a
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              Profilni ko'rish
            </a>
          )}
          <button
            onClick={handleSubmit((d) => save(d))}
            disabled={isSubmitting || !isDirty}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Saqlash
          </button>
        </div>
      </div>

      {/* Published toggle */}
      <div className="flex items-center justify-between rounded-xl border bg-card p-4">
        <div>
          <p className="font-medium text-sm">Profilni nashr qilish</p>
          <p className="text-xs text-muted-foreground">Yoqilsa, axoli portali da ko'rinadi</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" {...register('is_published')} className="sr-only peer" />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary" />
        </label>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit((d) => save(d))}>
        {/* Info tab */}
        {activeTab === 'info' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Qisqa tavsif (tagline)</label>
              <input
                {...register('tagline')}
                placeholder="Masalan: Toshkentning eng zamonaviy klinikasi"
                className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Batafsil tavsif</label>
              <textarea
                {...register('description')}
                rows={5}
                placeholder="Klinika haqida to'liq ma'lumot..."
                className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Banner rasm URL</label>
              <input
                {...register('banner_url')}
                type="url"
                placeholder="https://..."
                className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Mutaxassisliklar (vergul bilan)</label>
              <input
                {...register('specialties')}
                placeholder="Terapiya, Kardiologiya, Stomatologiya"
                className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Tashkil etilgan yil</label>
              <input
                {...register('established_year')}
                type="number"
                placeholder="2015"
                className="w-48 rounded-xl border bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        )}

        {/* Services tab */}
        {activeTab === 'services' && (
          <div className="space-y-3">
            {services.map((f, i) => (
              <div key={f.id} className="flex gap-2 items-start rounded-xl border bg-card p-3">
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <input
                    {...register(`services.${i}.name`)}
                    placeholder="Xizmat nomi *"
                    className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary col-span-2"
                  />
                  <input
                    {...register(`services.${i}.price_uzs`)}
                    type="number"
                    placeholder="Narx (so'm)"
                    className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
                  />
                  <input
                    {...register(`services.${i}.duration_min`)}
                    type="number"
                    placeholder="Davomiyligi (daqiqa)"
                    className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
                  />
                  <input
                    {...register(`services.${i}.description`)}
                    placeholder="Qisqa tavsif (ixtiyoriy)"
                    className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary col-span-2"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="text-destructive hover:bg-destructive/10 rounded-lg p-2 transition-colors mt-0.5"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => append({ name: '', price_uzs: undefined, duration_min: undefined, description: '' })}
              className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-2.5 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors w-full justify-center"
            >
              <Plus className="h-4 w-4" />
              Xizmat qo'shish
            </button>
          </div>
        )}

        {/* Hours tab */}
        {activeTab === 'hours' && (
          <div className="space-y-2">
            {DAY_KEYS.map((key, i) => {
              const h = workingHours[key] ?? { open: '09:00', close: '18:00', closed: false };
              return (
                <div key={key} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
                  <span className="w-24 text-sm font-medium">{DAYS[i]}</span>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={h.closed}
                      onChange={(e) => setWorkingHours((p) => ({ ...p, [key]: { ...h, closed: e.target.checked } }))}
                      className="h-3.5 w-3.5 accent-destructive"
                    />
                    Yopiq
                  </label>
                  {!h.closed && (
                    <>
                      <input
                        type="time"
                        value={h.open}
                        onChange={(e) => setWorkingHours((p) => ({ ...p, [key]: { ...h, open: e.target.value } }))}
                        className="rounded-lg border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
                      />
                      <span className="text-muted-foreground text-sm">—</span>
                      <input
                        type="time"
                        value={h.close}
                        onChange={(e) => setWorkingHours((p) => ({ ...p, [key]: { ...h, close: e.target.value } }))}
                        className="rounded-lg border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Location tab */}
        {activeTab === 'location' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Klinikangizning aniq joylashuvini kiriting. Bu axoli portalida xarita ko'rinishida chiqadi.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Kenglik (Latitude)</label>
                <input
                  {...register('geo_lat')}
                  type="number"
                  step="any"
                  placeholder="41.2995"
                  className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Uzunlik (Longitude)</label>
                <input
                  {...register('geo_lng')}
                  type="number"
                  step="any"
                  placeholder="69.2401"
                  className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
            <div className="rounded-xl border bg-muted/40 p-4 text-xs text-muted-foreground">
              💡 Google Maps dan koordinatalarni topish: klinika manzilingizni qidiring → o'ng klik → "Bu yerning koordinatalari"
            </div>
          </div>
        )}
      </form>

      {/* Analytics tab */}
      {activeTab === 'analytics' && (
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { label: 'Ko\'rishlar (hafta)', value: analytics?.views_week ?? 0, icon: Eye },
            { label: 'O\'rtacha reyting', value: analytics?.avg_rating ? `${analytics.avg_rating} ★` : '—', icon: Star },
            { label: 'Jami izohlar', value: analytics?.review_count ?? 0, icon: BarChart3 },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border bg-card shadow-sm p-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <s.icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
