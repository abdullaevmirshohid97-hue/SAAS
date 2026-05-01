import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@clary/ui-web';
import { Flag, Loader2, CheckCircle2, XCircle, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';

const KNOWN_FEATURES = [
  { key: 'online_queue',       label: 'Online navbat' },
  { key: 'home_nurse',         label: 'Uy hamshirasi' },
  { key: 'web_profile',        label: 'Web profil' },
  { key: 'reviews',            label: 'Izohlar' },
  { key: 'lab_integration',    label: 'Lab integratsiya' },
  { key: 'ai_assistant',       label: 'AI yordamchi' },
  { key: 'payroll',            label: 'Ish haqi' },
  { key: 'advanced_analytics', label: 'Kengaytirilgan analitika' },
];

interface FeatureFlag {
  clinic_id: string;
  feature: string;
  enabled: boolean;
  reason: string | null;
  enabled_at: string | null;
  clinic?: { id: string; name: string };
}

export function FeatureFlagsPage() {
  const qc = useQueryClient();
  const [featureFilter, setFeatureFilter] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [bulkFeature, setBulkFeature] = useState('');
  const [bulkEnabled, setBulkEnabled] = useState(true);

  const { data: flags, isLoading } = useQuery<FeatureFlag[]>({
    queryKey: ['feature-flags'],
    queryFn: () => api.get('/api/v1/admin/extras/feature-flags'),
  });

  const toggleMut = useMutation({
    mutationFn: ({ clinic_id, feature, enabled }: { clinic_id: string; feature: string; enabled: boolean }) =>
      api.post('/api/v1/admin/extras/feature-flags', {
        clinic_id,
        feature,
        enabled,
        reason: `Admin toggled ${enabled ? 'on' : 'off'}`,
      }),
    onSuccess: () => {
      toast.success('Flag yangilandi');
      qc.invalidateQueries({ queryKey: ['feature-flags'] });
    },
    onError: () => toast.error('Xatolik yuz berdi'),
  });

  const bulkMut = useMutation({
    mutationFn: ({ clinic_ids, feature, enabled }: { clinic_ids: string[]; feature: string; enabled: boolean }) =>
      api.post<{ updated: number }>('/api/v1/admin/extras/feature-flags/bulk', { clinic_ids, feature, enabled }),
    onSuccess: (r: { updated: number }) => {
      toast.success(`${r.updated} ta klinikada yangilandi`);
      qc.invalidateQueries({ queryKey: ['feature-flags'] });
      setShowBulk(false);
    },
    onError: () => toast.error('Xatolik yuz berdi'),
  });

  const filtered = (flags ?? []).filter((f) => !featureFilter || f.feature === featureFilter);

  const byClinic = new Map<string, { name: string; id: string; flags: FeatureFlag[] }>();
  for (const f of filtered) {
    if (!byClinic.has(f.clinic_id)) {
      byClinic.set(f.clinic_id, { id: f.clinic_id, name: f.clinic?.name ?? f.clinic_id, flags: [] });
    }
    byClinic.get(f.clinic_id)!.flags.push(f);
  }
  const clinics = Array.from(byClinic.values()).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Feature Flags</h1>
          <p className="text-sm text-muted-foreground">Har bir klinika uchun funksiyalarni boshqarish</p>
        </div>
        <Button variant="outline" onClick={() => setShowBulk(!showBulk)}>
          <Flag className="mr-1.5 h-4 w-4" />
          Ommaviy o'rnatish
          <ChevronDown className={`ml-1.5 h-4 w-4 transition-transform ${showBulk ? 'rotate-180' : ''}`} />
        </Button>
      </div>

      {showBulk && (
        <Card className="border-dashed border-amber-400/60 bg-amber-50/20">
          <CardHeader><CardTitle className="text-sm">Ommaviy feature flag o'rnatish</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Funksiya</label>
                <select
                  value={bulkFeature}
                  onChange={(e) => setBulkFeature(e.target.value)}
                  className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Tanlang...</option>
                  {KNOWN_FEATURES.map((f) => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Holat</label>
                <div className="flex gap-1 rounded-xl bg-muted/40 p-1">
                  <button
                    onClick={() => setBulkEnabled(true)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${bulkEnabled ? 'bg-background shadow-sm text-emerald-600' : 'text-muted-foreground'}`}
                  >
                    Yoqish
                  </button>
                  <button
                    onClick={() => setBulkEnabled(false)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${!bulkEnabled ? 'bg-background shadow-sm text-red-600' : 'text-muted-foreground'}`}
                  >
                    O'chirish
                  </button>
                </div>
              </div>
              <Button
                disabled={!bulkFeature || bulkMut.isPending || clinics.length === 0}
                onClick={() => bulkMut.mutate({ clinic_ids: clinics.map((c) => c.id), feature: bulkFeature, enabled: bulkEnabled })}
              >
                {bulkMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `${clinics.length} ta klinikaga qo'llash`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-1 rounded-xl bg-muted/40 p-1 flex-wrap">
        <button
          onClick={() => setFeatureFilter('')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${!featureFilter ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
        >
          Barchasi
        </button>
        {KNOWN_FEATURES.map((f) => (
          <button
            key={f.key}
            onClick={() => setFeatureFilter(featureFilter === f.key ? '' : f.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${featureFilter === f.key ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : clinics.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-muted-foreground">
          <Flag className="h-8 w-8 mb-2 opacity-30" />
          <p className="text-sm">Flaglar topilmadi</p>
        </div>
      ) : (
        <div className="space-y-3">
          {clinics.map((clinic) => (
            <Card key={clinic.id}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">{clinic.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {KNOWN_FEATURES.map((feat) => {
                    const flag = clinic.flags.find((f) => f.feature === feat.key);
                    const enabled = flag?.enabled ?? false;
                    return (
                      <button
                        key={feat.key}
                        onClick={() => toggleMut.mutate({ clinic_id: clinic.id, feature: feat.key, enabled: !enabled })}
                        disabled={toggleMut.isPending}
                        className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs transition-all ${
                          enabled
                            ? 'border-emerald-300 bg-emerald-50/50 text-emerald-700'
                            : 'border-border hover:bg-muted/40 text-muted-foreground'
                        }`}
                      >
                        <span className="font-medium">{feat.label}</span>
                        {enabled
                          ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                          : <XCircle className="h-4 w-4 text-muted-foreground/40 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
