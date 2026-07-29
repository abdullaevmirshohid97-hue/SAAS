import { Link } from 'react-router-dom';
import { MapPin, Phone, ChevronRight, Building2 } from 'lucide-react';

import type { ClinicPublic } from '@/lib/api';

interface Props {
  clinic: ClinicPublic;
}

export function ClinicCard({ clinic }: Props) {
  return (
    <Link
      to={`/clinics/${clinic.slug}`}
      className="bg-card group flex flex-col overflow-hidden rounded-2xl border shadow-sm transition-all duration-200 hover:shadow-md"
    >
      {/* Color bar */}
      <div
        className="h-1.5 w-full"
        style={{ backgroundColor: clinic.primary_color ?? '#2563eb' }}
      />

      <div className="flex items-start gap-4 p-4">
        {/* Logo */}
        <div className="bg-muted flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
          {clinic.logo_url ? (
            <img
              src={clinic.logo_url}
              alt={clinic.name}
              className="h-10 w-10 rounded-lg object-contain"
            />
          ) : (
            <Building2 className="text-muted-foreground h-6 w-6" />
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <h3 className="text-foreground group-hover:text-primary truncate font-semibold transition-colors">
            {clinic.name}
          </h3>
          <p className="text-muted-foreground mt-0.5 text-xs capitalize">
            {clinic.organization_type.replace('_', ' ')}
          </p>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {(clinic.city || clinic.address) && (
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <MapPin className="h-3 w-3 shrink-0" />
                {[clinic.city, clinic.address].filter(Boolean).join(', ')}
              </span>
            )}
            {clinic.phone && (
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <Phone className="h-3 w-3 shrink-0" />
                {clinic.phone}
              </span>
            )}
          </div>
        </div>

        <ChevronRight className="text-muted-foreground group-hover:text-primary h-5 w-5 shrink-0 transition-colors" />
      </div>

      <div className="px-4 pb-4">
        <span className="bg-primary/10 text-primary inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
          Navbatga yozilish
        </span>
      </div>
    </Link>
  );
}
