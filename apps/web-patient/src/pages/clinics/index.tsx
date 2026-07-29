import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, SlidersHorizontal, Loader2, X } from 'lucide-react';

import { clinicsApi } from '@/lib/api';
import { QK } from '@/lib/query-keys';
import { ClinicCard } from '@/components/clinic-card';

const CITIES = ['Toshkent', 'Samarqand', 'Buxoro', 'Namangan', 'Andijon', "Farg'ona", 'Nukus'];
const SPECIALTIES = [
  'Terapiya',
  'Stomatologiya',
  'Kardiologiya',
  'Ginekologiya',
  'Pediatriya',
  "Ko'z kasalliklari",
  'Nevrologia',
];

export function ClinicsPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [city, setCity] = useState(params.get('city') ?? '');
  const [specialty, setSpecialty] = useState(params.get('specialty') ?? '');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const searchParams = {
    ...(query ? { query } : {}),
    ...(city ? { city } : {}),
    ...(specialty ? { specialty } : {}),
  };

  const { data, isLoading } = useQuery({
    queryKey: QK.clinics(searchParams),
    queryFn: () => clinicsApi.search(searchParams),
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    if (city) next.set('city', city);
    if (specialty) next.set('specialty', specialty);
    setParams(next, { replace: true });
  }, [query, city, specialty, setParams]);

  const hasFilters = !!(query || city || specialty);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="mb-1 text-2xl font-bold">Klinikalar</h1>
        {data && <p className="text-muted-foreground text-sm">{data.total} ta klinika topildi</p>}
      </div>

      {/* Search + filters */}
      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Klinika nomi..."
            className="bg-background ring-offset-background focus:ring-primary w-full rounded-xl border py-2.5 pl-10 pr-4 text-sm outline-none transition-shadow focus:ring-2"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-muted-foreground hover:text-foreground absolute right-3 top-1/2 -translate-y-1/2"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          onClick={() => setFiltersOpen((p) => !p)}
          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
            filtersOpen || city || specialty
              ? 'bg-primary text-primary-foreground border-primary'
              : 'hover:bg-muted'
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">Filter</span>
        </button>
      </div>

      {/* Filter panel */}
      {filtersOpen && (
        <div className="bg-muted/30 mb-4 flex flex-wrap gap-4 rounded-xl border p-4">
          <div className="flex min-w-[160px] flex-col gap-1">
            <label className="text-muted-foreground text-xs font-medium">Shahar</label>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="bg-background focus:ring-primary rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
            >
              <option value="">Barchasi</option>
              {CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-[180px] flex-col gap-1">
            <label className="text-muted-foreground text-xs font-medium">Mutaxassislik</label>
            <select
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              className="bg-background focus:ring-primary rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
            >
              <option value="">Barchasi</option>
              {SPECIALTIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          {hasFilters && (
            <div className="flex items-end">
              <button
                onClick={() => {
                  setQuery('');
                  setCity('');
                  setSpecialty('');
                }}
                className="text-destructive flex items-center gap-1 text-xs hover:underline"
              >
                <X className="h-3 w-3" />
                Tozalash
              </button>
            </div>
          )}
        </div>
      )}

      {/* Active filter chips */}
      {hasFilters && !filtersOpen && (
        <div className="mb-4 flex flex-wrap gap-2">
          {city && (
            <span className="bg-primary/10 text-primary flex items-center gap-1 rounded-full px-3 py-1 text-xs">
              {city}
              <button onClick={() => setCity('')}>
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {specialty && (
            <span className="bg-primary/10 text-primary flex items-center gap-1 rounded-full px-3 py-1 text-xs">
              {specialty}
              <button onClick={() => setSpecialty('')}>
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
        </div>
      )}

      {/* Results */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
        </div>
      ) : !data || data.data.length === 0 ? (
        <div className="text-muted-foreground py-16 text-center">
          <Search className="mx-auto mb-3 h-12 w-12 opacity-30" />
          <p className="font-medium">Klinika topilmadi</p>
          <p className="mt-1 text-sm">Boshqa kalit so'z bilan qidiring</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.data.map((c) => (
            <ClinicCard key={c.id} clinic={c} />
          ))}
        </div>
      )}
    </div>
  );
}
