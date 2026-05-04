import { useState } from 'react';

type Scenario = 'revenue' | 'queue' | 'cohort' | 'summary';

const SCENARIOS: Record<Scenario, { title: string; input: string; analysis: string[]; metric: string }> = {
  revenue: {
    title: 'Daromad prognozi',
    input: "Oxirgi 30 kunlik daromad: 240 mln UZS · O'rtacha kunlik chek: 180K · Bemor oqimi: 40/kun",
    analysis: [
      "📈 Joriy oyni 268 mln UZS bilan yopish prognozlanmoqda (+11.6%)",
      "⚠️ Chorshanba va Payshanba kunlari oqim 22% past — bu kunlar uchun aksiya tavsiya etiladi",
      "💡 Diagnostika xizmatlari hissasi 18% — 25% ga ko'tarish daromadni 14% oshiradi",
      "🎯 Tavsiya: USG va ECG paketini 280K UZSga 'Kompleks tekshiruv' sifatida sotish",
    ],
    metric: '+11.6%',
  },
  queue: {
    title: 'Navbat optimallashtirish',
    input: "Bugun: 47 navbat · O'rtacha kutish: 28 daq · Peak: 10:00-12:00 · Doctor utilization: 73%",
    analysis: [
      "⏱ Kutish vaqtini 18 daqiqaga tushirish mumkin (35% kamayish)",
      "🩺 Dr. Karimov 92% band, Dr. Yusupova 51% — yuk taqsimotini muvozanatlash kerak",
      "⏰ 10:30-11:30 oralig'iga 2 ta qo'shimcha slot yaratish tavsiya etiladi",
      "🎯 Tavsiya: 30 daqiqalik blok o'rniga 20+10 model — 25% ko'proq bemor",
    ],
    metric: '−35% kutish',
  },
  cohort: {
    title: 'Bemor segmentatsiyasi',
    input: '1,247 ta faol bemor · Qaytish koefitsienti: 41% · Loyalty programmaga kirgan: 168',
    analysis: [
      "👥 4 ta segment aniqlandi: Yangi (32%), Doimiy (41%), Uxlovchi (19%), Yo'qotilgan (8%)",
      "🎯 'Uxlovchi' segment (237 bemor) — 30 kun ichida SMS bilan 18% qaytarib bo'ladi",
      "💎 VIP klaster (89 bemor) — yiliga o'rtacha 4.2 mln UZS, alohida e'tibor talab qiladi",
      "🎯 Tavsiya: Avtomatik 'Sog'lig'ingiz qanday?' SMS — 7 va 30 kun keyin",
    ],
    metric: '+18% qaytarish',
  },
  summary: {
    title: 'Bugun nima muhim?',
    input: 'Real-time klinika holati · 09:14 · Toshkent',
    analysis: [
      "✅ 3 shifokor smenada, 1 ta dars (Dr. Sodiqov 14:00 dan keyin)",
      "⚠️ USG kabineti 11:00 dan ortiqcha bron — 2 ta vaqtni siljitish kerak",
      "💰 Kassa: 8.4 mln UZS yig'ildi (kunlik plan: 12 mln, 70%)",
      "🔔 3 ta bemor 24 soatdan ortiq javob kutmoqda — call-back ro'yxatiga qo'shildi",
    ],
    metric: '4 ta diqqat',
  },
};

export function AiDemo() {
  const [active, setActive] = useState<Scenario>('revenue');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string[] | null>(null);

  function run() {
    setRunning(true);
    setResult(null);
    setTimeout(() => {
      setResult(SCENARIOS[active].analysis);
      setRunning(false);
      try {
        // @ts-expect-error PostHog optional
        window.posthog?.capture?.('ai_demo_run', { scenario: active });
      } catch {}
    }, 1400);
  }

  function pick(s: Scenario) {
    setActive(s);
    setResult(null);
  }

  const scenario = SCENARIOS[active];

  return (
    <div className="rounded-2xl border bg-card shadow-lg">
      <div className="grid gap-4 p-3 sm:grid-cols-4">
        {(Object.keys(SCENARIOS) as Scenario[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => pick(s)}
            className={`rounded-lg border p-3 text-left text-sm transition ${
              active === s ? 'border-[#2563EB] bg-[#2563EB]/5 font-semibold' : 'hover:bg-accent'
            }`}
          >
            {SCENARIOS[s].title}
          </button>
        ))}
      </div>

      <div className="border-t p-6">
        <div className="rounded-lg bg-muted/40 p-4 text-xs font-mono">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Input ma'lumot
          </div>
          {scenario.input}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Clary AI tahlilni 1.5 sekundda chiqaradi
          </div>
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="rounded-md bg-[#2563EB] px-5 py-2 text-sm font-semibold text-white shadow hover:bg-[#1D4ED8] disabled:opacity-60"
          >
            {running ? 'Tahlil qilinmoqda…' : '▶ AI tahlilni ishga tushirish'}
          </button>
        </div>

        <div className="mt-5 min-h-[240px] rounded-lg border-2 border-dashed border-muted bg-background p-5">
          {!result && !running && (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <div className="text-2xl">✨</div>
              <p className="mt-2">"AI tahlilni ishga tushirish" tugmasini bosing</p>
            </div>
          )}

          {running && (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#2563EB] border-t-transparent" />
              <p>Klaster tahlili, anomaliya aniqlanishi, prognoz...</p>
            </div>
          )}

          {result && (
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#10B981]/10 px-3 py-1 text-xs font-bold text-[#10B981]">
                ★ {scenario.metric}
              </div>
              <ul className="space-y-2.5 text-sm">
                {result.map((line, i) => (
                  <li key={i} className="leading-relaxed">{line}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
