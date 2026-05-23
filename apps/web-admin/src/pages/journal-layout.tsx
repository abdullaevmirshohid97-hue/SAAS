import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@clary/ui-web';
import { Lock, Unlock, Eye, EyeOff, ArrowUp, ArrowDown, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';

type Default = {
  id: string;
  source_key: string;
  display_label_i18n: Record<string, string>;
  color_tone: string;
  icon_key: string;
  sort_order: number;
  is_visible: boolean;
  lock_label: boolean;
  lock_color: boolean;
  lock_icon: boolean;
  lock_order: boolean;
  lock_visible: boolean;
};

const COLOR_PALETTE = [
  'emerald', 'violet', 'sky', 'indigo', 'amber', 'rose', 'cyan',
  'slate', 'blue', 'green', 'orange', 'pink', 'teal', 'red',
];

export function JournalLayoutPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<Default[]>({
    queryKey: ['admin', 'journal-layout-defaults'],
    queryFn: () => api.adminJournalLayout.listDefaults(),
  });

  const upsertMut = useMutation({
    mutationFn: (body: Partial<Default> & { source_key: string }) =>
      api.adminJournalLayout.upsertDefault(body),
    onSuccess: () => {
      toast.success('Saqlandi');
      qc.invalidateQueries({ queryKey: ['admin', 'journal-layout-defaults'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Jurnal shabloni (global)</h1>
        <p className="text-sm text-muted-foreground">
          Barcha klinikalar uchun standart jurnal ko‘rinishi. Har maydonni qulflashingiz mumkin —
          qulflangan maydon klinika administratorlari tomonidan o‘zgartirilmaydi.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {(data ?? [])
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((row) => (
              <SourceCard key={row.id} row={row} onSave={(b) => upsertMut.mutate(b)} />
            ))}
        </div>
      )}
    </div>
  );
}

function SourceCard({ row, onSave }: { row: Default; onSave: (b: Partial<Default> & { source_key: string }) => void }) {
  const [label, setLabel] = useState(row.display_label_i18n['uz-Latn'] ?? '');
  const [labelRu, setLabelRu] = useState(row.display_label_i18n['ru'] ?? '');
  const [color, setColor] = useState(row.color_tone);
  const [iconKey, setIconKey] = useState(row.icon_key);
  const [order, setOrder] = useState(row.sort_order);
  const [visible, setVisible] = useState(row.is_visible);
  const [locks, setLocks] = useState({
    label: row.lock_label,
    color: row.lock_color,
    icon: row.lock_icon,
    order: row.lock_order,
    visible: row.lock_visible,
  });

  useEffect(() => {
    setLabel(row.display_label_i18n['uz-Latn'] ?? '');
    setLabelRu(row.display_label_i18n['ru'] ?? '');
    setColor(row.color_tone);
    setIconKey(row.icon_key);
    setOrder(row.sort_order);
    setVisible(row.is_visible);
    setLocks({
      label: row.lock_label,
      color: row.lock_color,
      icon: row.lock_icon,
      order: row.lock_order,
      visible: row.lock_visible,
    });
  }, [row]);

  const save = () => {
    onSave({
      source_key: row.source_key,
      display_label_i18n: { 'uz-Latn': label, ru: labelRu },
      color_tone: color,
      icon_key: iconKey,
      sort_order: order,
      is_visible: visible,
      lock_label: locks.label,
      lock_color: locks.color,
      lock_icon: locks.icon,
      lock_order: locks.order,
      lock_visible: locks.visible,
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-mono">{row.source_key}</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant={visible ? 'default' : 'secondary'} className="gap-1">
            {visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            {visible ? 'Ko‘rinadi' : 'Yashirin'}
          </Badge>
          <span
            className={`inline-block h-4 w-4 rounded border bg-${color}-100 dark:bg-${color}-900/40`}
            title={color}
          />
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        <FieldWithLock
          label="Nom (uz-Latn)"
          locked={locks.label}
          onLockChange={(v) => setLocks((s) => ({ ...s, label: v }))}
        >
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </FieldWithLock>
        <FieldWithLock label="Nom (ru)" locked={locks.label} onLockChange={() => {}}>
          <Input value={labelRu} onChange={(e) => setLabelRu(e.target.value)} />
        </FieldWithLock>

        <FieldWithLock
          label="Rang"
          locked={locks.color}
          onLockChange={(v) => setLocks((s) => ({ ...s, color: v }))}
        >
          <div className="flex flex-wrap gap-1">
            {COLOR_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded border-2 bg-${c}-100 dark:bg-${c}-900/40 ${
                  color === c ? 'border-foreground' : 'border-transparent'
                }`}
                title={c}
              />
            ))}
          </div>
        </FieldWithLock>

        <FieldWithLock
          label="Belgi (lucide icon key)"
          locked={locks.icon}
          onLockChange={(v) => setLocks((s) => ({ ...s, icon: v }))}
        >
          <Input value={iconKey} onChange={(e) => setIconKey(e.target.value)} placeholder="wallet, receipt, ..." />
        </FieldWithLock>

        <FieldWithLock
          label="Tartib"
          locked={locks.order}
          onLockChange={(v) => setLocks((s) => ({ ...s, order: v }))}
        >
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => setOrder((n) => Math.max(0, n - 10))}>
              <ArrowUp className="h-3 w-3" />
            </Button>
            <Input type="number" value={order} onChange={(e) => setOrder(Number(e.target.value) || 0)} className="w-24" />
            <Button size="sm" variant="outline" onClick={() => setOrder((n) => n + 10)}>
              <ArrowDown className="h-3 w-3" />
            </Button>
          </div>
        </FieldWithLock>

        <FieldWithLock
          label="Ko‘rinishi"
          locked={locks.visible}
          onLockChange={(v) => setLocks((s) => ({ ...s, visible: v }))}
        >
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
            Yoqilgan
          </label>
        </FieldWithLock>

        <div className="md:col-span-2 flex justify-end">
          <Button size="sm" onClick={save} className="gap-1">
            <Save className="h-4 w-4" />
            Saqlash
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FieldWithLock({
  label,
  locked,
  onLockChange,
  children,
}: {
  label: string;
  locked: boolean;
  onLockChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <button
          type="button"
          onClick={() => onLockChange(!locked)}
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
            locked ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground'
          }`}
          title={locked ? 'Qulflangan — klinika o‘zgartira olmaydi' : 'Erkin'}
        >
          {locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
          {locked ? 'Qulflangan' : 'Erkin'}
        </button>
      </div>
      {children}
    </div>
  );
}
