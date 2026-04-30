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
    { icon: Search, title: 'Klinika qidirish', desc: 'Shahar va mutaxassislik bo\'yicha toping' },
    { icon: Calendar, title: 'Online navbat', desc: 'Real vaqt rejimida slot band qiling' },
    { icon: MapPin, title: 'Uyga hamshira', desc: 'Malakali hamshira uyingizga keladi' },
    { icon: Shield, title: 'Xavfsiz', desc: 'Ma\'lumotlaringiz himoyalangan' },
  ];

  const stats = [
    { value: '200+', label: 'Klinika' },
    { value: '1000+', label: 'Shifokor' },
    { value: '50,000+', label: 'Navbat berilgan' },
    { value: '4.8★', label: 'O\'rtacha reyting' },
  ];

  return (
    <div>
      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-background py-20 px-4">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary mb-6">
            <Star className="h-4 w-4" />
            O'zbekistonning №1 sog'liq portali
          </div>
          <h1 className="text-4xl sm:text-5xl font-black text-foreground leading-tight mb-4">
            Klinikani toping,<br />
            <span className="text-primary">navbatga yoziling</span>
          </h1>
          <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
            200+ klinika, online navbat va uyga hamshira xizmati — barchasi bir platformada.
          </p>

          {/* Search bar */}
          <form onSubmit={handleSearch} className="flex gap-2 max-w-xl mx-auto">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Klinika yoki mutaxassislik..."
                className="w-full rounded-xl border bg-background pl-11 pr-4 py-3 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-primary transition-shadow"
              />
            </div>
            <button
              type="submit"
              className="flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Qidirish
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        </div>
      </section>

      {/* ── Stats ─────────────────────────────────────────────── */}
      <section className="border-y bg-muted/30 py-8 px-4">
        <div className="mx-auto max-w-4xl grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {stats.map((s) => (
            <div key={s.label}>
              <p className="text-2xl font-black text-primary">{s.value}</p>
              <p className="text-sm text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────── */}
      <section className="py-16 px-4">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-bold text-center mb-2">Nima qila olasiz?</h2>
          <p className="text-center text-muted-foreground mb-10">Bir platformada barcha tibbiy xizmatlar</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {features.map((f) => (
              <div key={f.title} className="flex flex-col items-center text-center rounded-2xl border bg-card p-6 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 mb-3">
                  <f.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-sm mb-1">{f.title}</h3>
                <p className="text-xs text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Featured clinics ──────────────────────────────────── */}
      {data && data.data.length > 0 && (
        <section className="py-10 px-4 bg-muted/20">
          <div className="mx-auto max-w-5xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">Mashhur klinikalar</h2>
              <button
                onClick={() => navigate('/clinics')}
                className="flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Barchasini ko'rish
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.data.slice(0, 6).map((c) => (
                <ClinicCard key={c.id} clinic={c} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── How it works ──────────────────────────────────────── */}
      <section className="py-16 px-4">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold mb-2">Qanday ishlaydi?</h2>
          <p className="text-muted-foreground mb-10">3 oddiy qadam</p>
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              { step: '1', icon: Search, text: 'Klinika yoki shifokorni qidiring' },
              { step: '2', icon: Clock, text: 'Qulay vaqtni tanlang' },
              { step: '3', icon: Calendar, text: 'Navbatni tasdiqlab oling' },
            ].map((s) => (
              <div key={s.step} className="flex flex-col items-center gap-3">
                <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                  <s.icon className="h-6 w-6" />
                  <span className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-foreground text-background text-xs font-bold flex items-center justify-center">
                    {s.step}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
