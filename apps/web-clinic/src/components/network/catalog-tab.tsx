import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FileText, Layers, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Button, Card, CardContent, ConfirmDialog } from '@clary/ui-web';
import type {
  NetworkBranch,
  NetworkCatalogKind,
  NetworkCatalogPushResult,
} from '@clary/api-client';

import { api } from '@/lib/api';
import { BranchChecklist } from './shared';

const KINDS: Array<{ id: NetworkCatalogKind; label: string }> = [
  { id: 'services', label: 'Xizmatlar va narxlar' },
  { id: 'lab', label: 'Laboratoriya tahlillari' },
  { id: 'diagnostics', label: 'Diagnostika (UZI, rentgen...)' },
];
const KIND_LABEL: Record<NetworkCatalogKind, string> = {
  services: 'Xizmatlar',
  lab: 'Laboratoriya',
  diagnostics: 'Diagnostika',
};

/**
 * HQ'dan markaziy boshqaruv: katalogni va hujjat sozlamalarini filiallarga
 * tarqatish. Filial o'z qo'shgan xizmatlari saqlanadi; narx — qulflangan
 * xizmatlarda yoki "narxlarni ham yangilash" belgilansa HQ'niki.
 */
export function CatalogTab({ branches }: { branches: NetworkBranch[] }) {
  const hq = branches.find((b) => b.is_hq) ?? branches[0];
  const [source, setSource] = useState(hq?.id ?? '');
  const [targets, setTargets] = useState<string[]>([]);
  const [kinds, setKinds] = useState<NetworkCatalogKind[]>(['services']);
  const [updatePrices, setUpdatePrices] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<NetworkCatalogPushResult | null>(null);

  const [setTargetsS, setSetTargetsS] = useState<string[]>([]);
  const [keys, setKeys] = useState<Array<'receipt' | 'document' | 'logo'>>(['receipt', 'document']);

  const push = useMutation({
    mutationFn: () =>
      api.company.pushCatalog({
        source_clinic_id: source,
        target_clinic_ids: targets,
        kinds,
        update_prices: updatePrices,
      }),
    onSuccess: (r) => {
      setResult(r);
      toast.success('Katalog tarqatildi');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const pushSettings = useMutation({
    mutationFn: () =>
      api.company.pushSettings({ source_clinic_id: source, target_clinic_ids: setTargetsS, keys }),
    onSuccess: (r) => toast.success(`${r.updated} ta filial yangilandi`),
    onError: (e: Error) => toast.error(e.message),
  });

  const nameOf = (id: string) => branches.find((b) => b.id === id)?.name ?? id;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center gap-2 font-semibold">
            <Layers className="h-4 w-4" /> Katalogni filiallarga tarqatish
          </div>
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground text-xs">Manba filial (odatda HQ)</span>
            <select
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setTargets((t) => t.filter((x) => x !== e.target.value));
              }}
              className="bg-background h-9 w-full max-w-sm rounded-md border px-2 text-sm"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.is_hq ? ' (HQ)' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-1">
            <span className="text-muted-foreground text-xs">Nimani</span>
            <div className="flex flex-wrap gap-3">
              {KINDS.map((k) => (
                <label key={k.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={kinds.includes(k.id)}
                    onChange={(e) =>
                      setKinds(
                        e.target.checked ? [...kinds, k.id] : kinds.filter((x) => x !== k.id),
                      )
                    }
                  />
                  {k.label}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-muted-foreground text-xs">Qaysi filiallarga</span>
            <BranchChecklist
              branches={branches}
              value={targets}
              onChange={setTargets}
              exclude={[source]}
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={updatePrices}
              onChange={(e) => setUpdatePrices(e.target.checked)}
            />
            <span>
              Narxlarni ham HQ narxiga tenglash
              <span className="text-muted-foreground block text-xs">
                Belgilanmasa: yangi xizmat HQ narxi bilan qo'shiladi, mavjudlarining narxi filialda
                o'zgarmaydi (faqat "narx qulflangan" xizmatlar HQ narxiga tenglanadi).
              </span>
            </span>
          </label>
          <Button
            disabled={!source || targets.length === 0 || kinds.length === 0 || push.isPending}
            onClick={() => setConfirm(true)}
          >
            <Send className="mr-1 h-4 w-4" /> Tarqatish ({targets.length} filial)
          </Button>

          {result && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="py-1.5">Filial</th>
                    {kinds.map((k) => (
                      <th key={k} className="text-right">
                        {KIND_LABEL[k]}: yangi / yangilandi / arxiv
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(result.result).map(([cid, stats]) => (
                    <tr key={cid} className="border-b last:border-0">
                      <td className="py-1.5">{nameOf(cid)}</td>
                      {kinds.map((k) => (
                        <td key={k} className="text-right">
                          {stats[k]
                            ? `${stats[k]!.inserted} / ${stats[k]!.updated} / ${stats[k]!.archived}`
                            : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center gap-2 font-semibold">
            <FileText className="h-4 w-4" /> Chek, blanka va logotipni tarqatish
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            {(
              [
                ['receipt', 'Chek sozlamalari'],
                ['document', 'A4 blanka'],
                ['logo', 'Logotip va rang'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={keys.includes(k)}
                  onChange={(e) =>
                    setKeys(e.target.checked ? [...keys, k] : keys.filter((x) => x !== k))
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <BranchChecklist
            branches={branches}
            value={setTargetsS}
            onChange={setSetTargetsS}
            exclude={[source]}
          />
          <Button
            variant="outline"
            disabled={setTargetsS.length === 0 || keys.length === 0 || pushSettings.isPending}
            onClick={() => pushSettings.mutate()}
          >
            <Send className="mr-1 h-4 w-4" /> {nameOf(source)} sozlamalarini qo'llash
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Katalogni tarqatish"
        description={`${nameOf(source)} katalogi ${targets.length} ta filialga qo'llanadi. Bir xil nomli xizmatlar bog'lanadi, yangilari qo'shiladi, HQ'da arxivlanganlari filialda ham arxivlanadi.`}
        confirmLabel="Tarqatish"
        onConfirm={() => {
          setConfirm(false);
          push.mutate();
        }}
      />
    </div>
  );
}
