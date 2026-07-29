import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  MapPin,
  Phone,
  Globe,
  ArrowLeft,
  Building2,
  Stethoscope,
  Loader2,
  CheckCircle2,
} from 'lucide-react';

import { clinicsApi } from '@/lib/api';
import { QK } from '@/lib/query-keys';
import { BookingWidget } from '@/components/booking-widget';

export function ClinicDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [bookedId, setBookedId] = useState<string | null>(null);

  const { data: clinic, isLoading } = useQuery({
    queryKey: QK.clinic(slug!),
    queryFn: () => clinicsApi.detail(slug!),
    enabled: !!slug,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!clinic) {
    return (
      <div className="text-muted-foreground py-24 text-center">
        <p>Klinika topilmadi</p>
        <button
          onClick={() => navigate('/clinics')}
          className="text-primary mt-4 text-sm hover:underline"
        >
          Orqaga
        </button>
      </div>
    );
  }

  if (bookedId) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-green-100 dark:bg-green-950">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold">Navbat olindi!</h2>
        <p className="text-muted-foreground text-sm">Navbatingiz muvaffaqiyatli band qilindi.</p>
        <div className="mt-2 flex gap-3">
          <button
            onClick={() => navigate(`/queue/${bookedId}`)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors"
          >
            Navbatni kuzatish
          </button>
          <button
            onClick={() => navigate('/appointments')}
            className="hover:bg-muted rounded-xl border px-5 py-2.5 text-sm font-medium transition-colors"
          >
            Navbatlarim
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        className="text-muted-foreground hover:text-foreground mb-6 flex items-center gap-2 text-sm transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Orqaga
      </button>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: info */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          {/* Header card */}
          <div className="bg-card overflow-hidden rounded-2xl border shadow-sm">
            <div
              className="h-2 w-full"
              style={{ backgroundColor: clinic.primary_color ?? '#2563eb' }}
            />
            <div className="flex items-start gap-4 p-6">
              <div className="bg-muted flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl">
                {clinic.logo_url ? (
                  <img
                    src={clinic.logo_url}
                    alt={clinic.name}
                    className="h-14 w-14 rounded-xl object-contain"
                  />
                ) : (
                  <Building2 className="text-muted-foreground h-8 w-8" />
                )}
              </div>
              <div className="flex-1">
                <h1 className="text-xl font-bold">{clinic.name}</h1>
                <p className="text-muted-foreground text-sm capitalize">
                  {clinic.organization_type.replace('_', ' ')}
                </p>

                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                  {(clinic.city || clinic.address) && (
                    <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
                      <MapPin className="h-4 w-4 shrink-0" />
                      {[clinic.city, clinic.address].filter(Boolean).join(', ')}
                    </span>
                  )}
                  {clinic.phone && (
                    <a
                      href={`tel:${clinic.phone}`}
                      className="text-primary flex items-center gap-1.5 text-sm hover:underline"
                    >
                      <Phone className="h-4 w-4 shrink-0" />
                      {clinic.phone}
                    </a>
                  )}
                  {clinic.website && (
                    <a
                      href={clinic.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary flex items-center gap-1.5 text-sm hover:underline"
                    >
                      <Globe className="h-4 w-4 shrink-0" />
                      Sayt
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Doctors */}
          {clinic.doctors && clinic.doctors.length > 0 && (
            <div className="bg-card rounded-2xl border p-4 shadow-sm">
              <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
                <Stethoscope className="text-primary h-5 w-5" />
                Shifokorlar ({clinic.doctors.length})
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {clinic.doctors.map((d) => (
                  <div key={d.id} className="bg-muted/40 flex items-center gap-3 rounded-xl p-3">
                    <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold">
                      {d.full_name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{d.full_name}</p>
                      {d.specialization && (
                        <p className="text-muted-foreground truncate text-xs">{d.specialization}</p>
                      )}
                      {d.experience_years && (
                        <p className="text-muted-foreground text-xs">
                          {d.experience_years} yil tajriba
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: booking widget */}
        <div className="lg:col-span-1">
          <div className="sticky top-24">
            <BookingWidget
              clinicSlug={slug!}
              doctors={clinic.doctors ?? []}
              onBooked={setBookedId}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
