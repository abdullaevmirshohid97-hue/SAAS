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
      className="group flex flex-col rounded-2xl border bg-card shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden"
    >
      {/* Color bar */}
      <div
        className="h-1.5 w-full"
        style={{ backgroundColor: clinic.primary_color ?? '#2563eb' }}
      />

      <div className="flex items-start gap-4 p-4">
        {/* Logo */}
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted">
          {clinic.logo_url ? (
            <img src={clinic.logo_url} alt={clinic.name} className="h-10 w-10 rounded-lg object-contain" />
          ) : (
            <Building2 className="h-6 w-6 text-muted-foreground" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
            {clinic.name}
          </h3>
          <p className="text-xs text-muted-foreground capitalize mt-0.5">
            {clinic.organization_type.replace('_', ' ')}
          </p>

          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {(clinic.city || clinic.address) && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3 shrink-0" />
                {[clinic.city, clinic.address].filter(Boolean).join(', ')}
              </span>
            )}
            {clinic.phone && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Phone className="h-3 w-3 shrink-0" />
                {clinic.phone}
              </span>
            )}
          </div>
        </div>

        <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
      </div>

      <div className="px-4 pb-4">
        <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
          Navbatga yozilish
        </span>
      </div>
    </Link>
  );
}
