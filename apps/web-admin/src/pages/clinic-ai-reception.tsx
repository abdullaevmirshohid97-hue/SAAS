import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, PhoneCall, Save } from 'lucide-react';
import { Badge, Button, Input, Label } from '@clary/ui-web';
import { toast } from 'sonner';

import { api } from '@/lib/api';

// =============================================================================
// Super admin → klinika → "AI qabulxona": premium ruxsat va oylik chegara.
// AI rejimi pullik (LLM + nutq) — klinika o'zi yoqa olmaydi. Ovozli xabar va
// Telegram tugmali navbat hammaga bepul. Pastda — bulutli ATS holati (faqat ko'rish).
// =============================================================================

const fmt = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('uz-UZ');
const MODE: Record<string, string> = { off: "O'chiq", voicemail: 'Ovozli xabar', ai: 'AI suhbat' };

export function ClinicAiReceptionTab({ clinicId }: { clinicId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin', 'ai-reception', clinicId],
    queryFn: () => api.aiReception.adminGet(clinicId),
  });
  const [allowed, setAllowed] = useState(false);
  const [limit, setLimit] = useState('0');
  useEffect(() => {
    if (q.data) {
      setAllowed(q.data.settings.ai_allowed);
      setLimit(String(q.data.settings.monthly_call_limit));
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      api.aiReception.adminSet(clinicId, {
        ai_allowed: allowed,
        monthly_call_limit: Math.max(0, Number(limit) || 0),
      }),
    onSuccess: () => {
      toast.success('Saqlandi');
      void qc.invalidateQueries({ queryKey: ['admin', 'ai-reception', clinicId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <div className="text-muted-foreground text-sm">Yuklanmoqda…</div>;
  if (q.error || !q.data) {
    return (
      <div className="text-destructive text-sm">{(q.error as Error | null)?.message ?? 'Xato'}</div>
    );
  }
  const { settings, usage, lines } = q.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Bot className="h-5 w-5" />
        <h2 className="text-lg font-semibold">AI qabulxona</h2>
        <Badge variant={settings.mode === 'off' ? 'outline' : 'success'}>
          {MODE[settings.mode]}
        </Badge>
        <Badge variant={settings.ai_allowed ? 'success' : 'outline'}>
          {settings.ai_allowed ? 'Premium yoqilgan' : 'Premium yoqilmagan'}
        </Badge>
      </div>

      <div className="grid gap-2 text-sm sm:grid-cols-4">
        <Kpi label="Qo'ng'iroq (oy)" value={`${usage.calls} (AI ${usage.ai_calls})`} />
        <Kpi label="Daqiqa (oy)" value={fmt(usage.minutes)} />
        <Kpi label="Yozilgan (oy)" value={fmt(usage.booked)} />
        <Kpi label="Xarajat (taxm.)" value={`${fmt(usage.cost_uzs)} so'm`} />
      </div>

      <div className="space-y-3 rounded-lg border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="accent-primary h-4 w-4"
            checked={allowed}
            onChange={(e) => setAllowed(e.target.checked)}
          />
          AI rejimiga ruxsat (premium) — telefon AI + Telegram AI chat
        </label>
        <div className="max-w-xs space-y-1">
          <Label>Oylik AI qo'ng'iroq chegarasi (0 = cheksiz)</Label>
          <Input type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)} />
          <p className="text-muted-foreground text-xs">
            Chegaradan oshsa qo'ng'iroqlar avtomatik "ovozli xabar" rejimiga o'tadi.
          </p>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          <Save className="mr-1.5 h-4 w-4" />
          Saqlash
        </Button>
        <p className="text-muted-foreground text-xs">
          Ruxsat olib tashlansa, AI rejimidagi klinika avtomatik "ovozli xabar" rejimiga o'tadi.
        </p>
      </div>

      <div className="space-y-1">
        <div className="text-sm font-semibold">Telefon liniyalari</div>
        {lines.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Liniya yo'q. Klinika Sozlamalar → AI qabulxona bo'limida qo'shadi (GoIP: goip1, SIP: DID
            raqam).
          </p>
        ) : (
          lines.map((l) => (
            <div key={l.id} className="flex flex-wrap gap-2 rounded border px-2 py-1 text-xs">
              <code>{l.line_key}</code>
              <span>AI: {l.phone_number ?? '—'}</span>
              <span className="text-muted-foreground">← {l.forwarded_from ?? '—'}</span>
              <Badge variant={l.is_active ? 'success' : 'outline'}>
                {l.is_active ? 'faol' : "o'chiq"}
              </Badge>
            </div>
          ))
        )}
      </div>

      <PbxSection clinicId={clinicId} />
    </div>
  );
}

/** Bulutli ATS (klinika IP-telefoniyasi) holati — klinika o'zi sozlaydi, bu yerda faqat ko'rish. */
function PbxSection({ clinicId }: { clinicId: string }) {
  const q = useQuery({
    queryKey: ['admin', 'telephony', clinicId],
    queryFn: () => api.telephony.adminGet(clinicId),
    refetchInterval: 30_000,
  });
  if (q.isLoading) return null;
  if (q.error || !q.data) {
    return (
      <div className="text-muted-foreground text-xs">
        Bulutli ATS: {(q.error as Error | null)?.message ?? 'maʼlumot yo‘q'}
      </div>
    );
  }
  const { server, tenant, extensions, month } = q.data;
  const status = (tenant?.trunk_status ?? '').toLowerCase();
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <PhoneCall className="h-4 w-4" />
        <span className="text-sm font-semibold">Bulutli ATS (IP-telefoniya)</span>
        <Badge variant={tenant?.enabled ? 'success' : 'outline'}>
          {tenant?.enabled ? 'Yoqilgan' : tenant ? "O'chiq" : 'Sozlanmagan'}
        </Badge>
        {tenant && (
          <Badge
            variant={
              status === 'registered'
                ? 'success'
                : status === 'rejected'
                  ? 'destructive'
                  : 'outline'
            }
          >
            Trunk: {tenant.trunk_status ?? 'tekshirilmagan'}
          </Badge>
        )}
        {!server.configured && <Badge variant="warning">Server: PBX_SIP_DOMAIN yo'q</Badge>}
      </div>
      {tenant && (
        <div className="grid gap-2 text-sm sm:grid-cols-4">
          <Kpi label="Raqam (DID)" value={tenant.did ?? '—'} />
          <Kpi
            label="SIP server / login"
            value={`${tenant.trunk_host ?? '—'} / ${tenant.trunk_username ?? '—'}`}
          />
          <Kpi label="Qo'ng'iroq (oy)" value={fmt(month.calls)} />
          <Kpi label="O'tkazib yuborilgan (oy)" value={fmt(month.missed)} />
        </div>
      )}
      {extensions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {extensions.map((e) => (
            <span key={e.id} className="rounded border px-2 py-0.5 text-xs">
              <code>{e.ext}</code> {e.label} {e.phone_status === 'online' ? '📞' : ''}
              {e.web_status === 'online' ? '💻' : ''}
              {!e.is_active ? " (o'chiq)" : ''}
            </span>
          ))}
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        Klinika o'zi sozlaydi: Sozlamalar → IP-telefoniya (ATS). Hujjat:
        docs/ai-reception/05-bulut-ats.md
      </p>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-2">
      <div className="text-muted-foreground text-[11px]">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
