import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, ArrowRight, Calendar, MapPin, Star, Shield, Clock } from 'lucide-react';

import { clinicsApi } from '@/lib/api';
import { QK } from '@/lib/query-keys';
import { ClinicCard } from '@/components/clinic-card';

export function HomePage() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: QK.clinics({ page: 1 }),
    queryFn: () => clinicsApi.search({ page: 1 }),
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    navigate(`/clinics${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  }

  const features = [
    { icon: Search, title: 'Klinika qidirish', desc: "Shahar va mutaxassislik bo'yicha toping" },
    { icon: Calendar, title: 'Online navbat', desc: 'Real vaqt rejimida slot band qiling' },
    { icon: MapPin, title: 'Uyga hamshira', desc: 'Malakali hamshira uyingizga keladi' },
    { icon: Shield, title: 'Xavfsiz', desc: "Ma'lumotlaringiz himoyalangan" },
  ];

  const stats = [
    { value: '200+', label: 'Klinika' },
    { value: '1000+', label: 'Shifokor' },
    { value: '50,000+', label: 'Navbat berilgan' },
    { value: '4.8★', label: "O'rtacha reyting" },
  ];

  return (
    <div>
      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="from-primary/5 via-background to-background relative overflow-hidden bg-gradient-to-br px-4 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <div className="bg-primary/10 text-primary mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium">
            <Star className="h-4 w-4" />
            O'zbekistonning №1 sog'liq portali
          </div>
          <h1 className="text-foreground mb-4 text-4xl font-black leading-tight sm:text-5xl">
            Klinikani toping,
            <br />
            <span className="text-primary">navbatga yoziling</span>
          </h1>
          <p className="text-muted-foreground mx-auto mb-8 max-w-xl text-lg">
            200+ klinika, online navbat va uyga hamshira xizmati — barchasi bir platformada.
          </p>

          {/* Search bar */}
          <form onSubmit={handleSearch} className="mx-auto flex max-w-xl gap-2">
            <div className="relative flex-1">
              <Search className="text-muted-foreground absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Klinika yoki mutaxassislik..."
                className="bg-background ring-offset-background focus:ring-primary w-full rounded-xl border py-3 pl-11 pr-4 text-sm outline-none transition-shadow focus:ring-2"
              />
            </div>
            <button
              type="submit"
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-colors"
            >
              Qidirish
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        </div>
      </section>

      {/* ── Stats ─────────────────────────────────────────────── */}
      <section className="bg-muted/30 border-y px-4 py-8">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-6 text-center sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label}>
              <p className="text-primary text-2xl font-black">{s.value}</p>
              <p className="text-muted-foreground text-sm">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────── */}
      <section className="px-4 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-2 text-center text-2xl font-bold">Nima qila olasiz?</h2>
          <p className="text-muted-foreground mb-10 text-center">
            Bir platformada barcha tibbiy xizmatlar
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => (
              <div
                key={f.title}
                className="bg-card flex flex-col items-center rounded-2xl border p-6 text-center shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="bg-primary/10 mb-3 flex h-12 w-12 items-center justify-center rounded-2xl">
                  <f.icon className="text-primary h-6 w-6" />
                </div>
                <h3 className="mb-1 text-sm font-semibold">{f.title}</h3>
                <p className="text-muted-foreground text-xs">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Featured clinics ──────────────────────────────────── */}
      {data && data.data.length > 0 && (
        <section className="bg-muted/20 px-4 py-10">
          <div className="mx-auto max-w-5xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold">Mashhur klinikalar</h2>
              <button
                onClick={() => navigate('/clinics')}
                className="text-primary flex items-center gap-1 text-sm hover:underline"
              >
                Barchasini ko'rish
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.data.slice(0, 6).map((c) => (
                <ClinicCard key={c.id} clinic={c} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── How it works ──────────────────────────────────────── */}
      <section className="px-4 py-16">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="mb-2 text-2xl font-bold">Qanday ishlaydi?</h2>
          <p className="text-muted-foreground mb-10">3 oddiy qadam</p>
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              { step: '1', icon: Search, text: 'Klinika yoki shifokorni qidiring' },
              { step: '2', icon: Clock, text: 'Qulay vaqtni tanlang' },
              { step: '3', icon: Calendar, text: 'Navbatni tasdiqlab oling' },
            ].map((s) => (
              <div key={s.step} className="flex flex-col items-center gap-3">
                <div className="bg-primary text-primary-foreground relative flex h-14 w-14 items-center justify-center rounded-2xl">
                  <s.icon className="h-6 w-6" />
                  <span className="bg-foreground text-background absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold">
                    {s.step}
                  </span>
                </div>
                <p className="text-muted-foreground text-sm">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
