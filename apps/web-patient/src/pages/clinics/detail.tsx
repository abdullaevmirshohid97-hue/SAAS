import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Phone, Globe, ArrowLeft, Building2, Stethoscope, Loader2, CheckCircle2 } from 'lucide-react';

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
      <div className="flex justify-center items-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!clinic) {
    return (
      <div className="text-center py-24 text-muted-foreground">
        <p>Klinika topilmadi</p>
        <button onClick={() => navigate('/clinics')} className="mt-4 text-primary text-sm hover:underline">
          Orqaga
        </button>
      </div>
    );
  }

  if (bookedId) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center flex flex-col items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-green-100 dark:bg-green-950">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold">Navbat olindi!</h2>
        <p className="text-muted-foreground text-sm">Navbatingiz muvaffaqiyatli band qilindi.</p>
        <div className="flex gap-3 mt-2">
          <button
            onClick={() => navigate(`/queue/${bookedId}`)}
            className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Navbatni kuzatish
          </button>
          <button
            onClick={() => navigate('/appointments')}
            className="px-5 py-2.5 rounded-xl border text-sm font-medium hover:bg-muted transition-colors"
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
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Orqaga
      </button>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: info */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* Header card */}
          <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
            <div className="h-2 w-full" style={{ backgroundColor: clinic.primary_color ?? '#2563eb' }} />
            <div className="p-6 flex items-start gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-muted">
                {clinic.logo_url ? (
                  <img src={clinic.logo_url} alt={clinic.name} className="h-14 w-14 rounded-xl object-contain" />
                ) : (
                  <Building2 className="h-8 w-8 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1">
                <h1 className="text-xl font-bold">{clinic.name}</h1>
                <p className="text-sm text-muted-foreground capitalize">{clinic.organization_type.replace('_', ' ')}</p>

                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
                  {(clinic.city || clinic.address) && (
                    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4 shrink-0" />
                      {[clinic.city, clinic.address].filter(Boolean).join(', ')}
                    </span>
                  )}
                  {clinic.phone && (
                    <a href={`tel:${clinic.phone}`} className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                      <Phone className="h-4 w-4 shrink-0" />
                      {clinic.phone}
                    </a>
                  )}
                  {clinic.website && (
                    <a href={clinic.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-primary hover:underline">
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
            <div className="rounded-2xl border bg-card shadow-sm p-4">
              <h2 className="font-semibold text-base mb-4 flex items-center gap-2">
                <Stethoscope className="h-5 w-5 text-primary" />
                Shifokorlar ({clinic.doctors.length})
              </h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {clinic.doctors.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 rounded-xl bg-muted/40 p-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold">
                      {d.full_name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{d.full_name}</p>
                      {d.specialization && (
                        <p className="text-xs text-muted-foreground truncate">{d.specialization}</p>
                      )}
                      {d.experience_years && (
                        <p className="text-xs text-muted-foreground">{d.experience_years} yil tajriba</p>
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
