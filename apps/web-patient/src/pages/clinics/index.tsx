import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, SlidersHorizontal, Loader2, X } from 'lucide-react';

import { clinicsApi } from '@/lib/api';
import { QK } from '@/lib/query-keys';
import { ClinicCard } from '@/components/clinic-card';

const CITIES = ['Toshkent', 'Samarqand', 'Buxoro', 'Namangan', 'Andijon', 'Farg\'ona', 'Nukus'];
const SPECIALTIES = ['Terapiya', 'Stomatologiya', 'Kardiologiya', 'Ginekologiya', 'Pediatriya', 'Ko\'z kasalliklari', 'Nevrologia'];

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
        <h1 className="text-2xl font-bold mb-1">Klinikalar</h1>
        {data && <p className="text-sm text-muted-foreground">{data.total} ta klinika topildi</p>}
      </div>

      {/* Search + filters */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Klinika nomi..."
            className="w-full rounded-xl border bg-background pl-10 pr-4 py-2.5 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-primary transition-shadow"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          onClick={() => setFiltersOpen((p) => !p)}
          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
            filtersOpen || city || specialty ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">Filter</span>
        </button>
      </div>

      {/* Filter panel */}
      {filtersOpen && (
        <div className="flex flex-wrap gap-4 mb-4 p-4 rounded-xl border bg-muted/30">
          <div className="flex flex-col gap-1 min-w-[160px]">
            <label className="text-xs font-medium text-muted-foreground">Shahar</label>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Barchasi</option>
              {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1 min-w-[180px]">
            <label className="text-xs font-medium text-muted-foreground">Mutaxassislik</label>
            <select
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Barchasi</option>
              {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {hasFilters && (
            <div className="flex items-end">
              <button
                onClick={() => { setQuery(''); setCity(''); setSpecialty(''); }}
                className="flex items-center gap-1 text-xs text-destructive hover:underline"
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
        <div className="flex flex-wrap gap-2 mb-4">
          {city && (
            <span className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">
              {city}
              <button onClick={() => setCity('')}><X className="h-3 w-3" /></button>
            </span>
          )}
          {specialty && (
            <span className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">
              {specialty}
              <button onClick={() => setSpecialty('')}><X className="h-3 w-3" /></button>
            </span>
          )}
        </div>
      )}

      {/* Results */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !data || data.data.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Search className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Klinika topilmadi</p>
          <p className="text-sm mt-1">Boshqa kalit so'z bilan qidiring</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.data.map((c) => (
            <ClinicCard key={c.id} clinic={c} />
          ))}
        </div>
      )}
    </div>
  );
}
