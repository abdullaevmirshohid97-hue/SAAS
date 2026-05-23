import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, Input, PageHeader } from '@clary/ui-web';
import { Lock, Eye, EyeOff, RotateCcw, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';

type Effective = {
  source_key: string;
  display_label_i18n: Record<string, string>;
  color_tone: string;
  icon_key: string;
  sort_order: number;
  is_visible: boolean;
  is_locked_label: boolean;
  is_locked_color: boolean;
  is_locked_icon: boolean;
  is_locked_order: boolean;
  is_locked_visible: boolean;
};

const COLOR_PALETTE = [
  'emerald', 'violet', 'sky', 'indigo', 'amber', 'rose', 'cyan',
  'slate', 'blue', 'green', 'orange', 'pink', 'teal', 'red',
];

export function JournalLayoutSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<Effective[]>({
    queryKey: ['journal-layout'],
    queryFn: () => api.journal.layout(),
  });

  const upsertMut = useMutation({
    mutationFn: (body: Parameters<typeof api.journal.upsertOverride>[0]) =>
      api.journal.upsertOverride(body),
    onSuccess: () => {
      toast.success('Saqlandi (faqat shu klinika uchun)');
      qc.invalidateQueries({ queryKey: ['journal-layout'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: (sourceKey: string) => api.journal.deleteOverride(sourceKey),
    onSuccess: () => {
      toast.success('Standartga qaytarildi');
      qc.invalidateQueries({ queryKey: ['journal-layout'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Sozlamalar"
        title="Jurnal ko‘rinishi"
        description="Jurnaldagi manbalarning nomi, rangi, tartibi va ko‘rinishini moslang. Qulflangan maydonlarni faqat platforma administratori o‘zgartira oladi."
      />

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {(data ?? []).map((row) => (
            <SourceRow
              key={row.source_key}
              row={row}
              onSave={(b) => upsertMut.mutate(b)}
              onReset={() => resetMut.mutate(row.source_key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceRow({
  row,
  onSave,
  onReset,
}: {
  row: Effective;
  onSave: (b: Parameters<typeof api.journal.upsertOverride>[0]) => void;
  onReset: () => void;
}) {
  const [label, setLabel] = useState(row.display_label_i18n['uz-Latn'] ?? '');
  const [color, setColor] = useState(row.color_tone);
  const [order, setOrder] = useState(row.sort_order);
  const [visible, setVisible] = useState(row.is_visible);

  useEffect(() => {
    setLabel(row.display_label_i18n['uz-Latn'] ?? '');
    setColor(row.color_tone);
    setOrder(row.sort_order);
    setVisible(row.is_visible);
  }, [row]);

  const allLocked =
    row.is_locked_label && row.is_locked_color && row.is_locked_order && row.is_locked_visible;

  const save = () => {
    onSave({
      source_key: row.source_key,
      display_label_i18n: row.is_locked_label ? undefined : { 'uz-Latn': label },
      color_tone: row.is_locked_color ? undefined : color,
      sort_order: row.is_locked_order ? undefined : order,
      is_visible: row.is_locked_visible ? undefined : visible,
    });
  };

  return (
    <Card>
      <CardContent className="grid gap-3 p-4 md:grid-cols-12">
        <div className="md:col-span-2">
          <div className="text-xs text-muted-foreground">Manba</div>
          <div className="font-mono text-sm">{row.source_key}</div>
          {allLocked && (
            <Badge variant="secondary" className="mt-1 gap-1">
              <Lock className="h-3 w-3" />
              Qulflangan
            </Badge>
          )}
        </div>

        <div className="md:col-span-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            Nom
            {row.is_locked_label && <Lock className="h-3 w-3 text-amber-600" />}
          </div>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={row.is_locked_label}
          />
        </div>

        <div className="md:col-span-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            Rang
            {row.is_locked_color && <Lock className="h-3 w-3 text-amber-600" />}
          </div>
          <div className="flex flex-wrap gap-1">
            {COLOR_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => !row.is_locked_color && setColor(c)}
                disabled={row.is_locked_color}
                className={`h-6 w-6 rounded border-2 bg-${c}-100 dark:bg-${c}-900/40 ${
                  color === c ? 'border-foreground' : 'border-transparent'
                } disabled:opacity-50`}
                title={c}
              />
            ))}
          </div>
        </div>

        <div className="md:col-span-2">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            Tartib
            {row.is_locked_order && <Lock className="h-3 w-3 text-amber-600" />}
          </div>
          <Input
            type="number"
            value={order}
            onChange={(e) => setOrder(Number(e.target.value) || 0)}
            disabled={row.is_locked_order}
          />
        </div>

        <div className="md:col-span-2 flex items-end">
          <button
            type="button"
            onClick={() => !row.is_locked_visible && setVisible((v) => !v)}
            disabled={row.is_locked_visible}
            className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs disabled:opacity-50 ${
              visible ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-300 bg-slate-50 text-slate-600'
            }`}
          >
            {visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            {visible ? 'Ko‘rinadi' : 'Yashirin'}
            {row.is_locked_visible && <Lock className="ml-1 h-3 w-3 text-amber-600" />}
          </button>
        </div>

        <div className="md:col-span-12 flex justify-end gap-2 border-t pt-2">
          <Button size="sm" variant="ghost" onClick={onReset} className="gap-1">
            <RotateCcw className="h-3.5 w-3.5" />
            Standartga qaytarish
          </Button>
          <Button size="sm" onClick={save} disabled={allLocked} className="gap-1">
            <Save className="h-3.5 w-3.5" />
            Saqlash
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
