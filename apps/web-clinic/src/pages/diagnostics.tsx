import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Plus, Settings, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  PageHeader,
  cn,
} from '@clary/ui-web';

import { api } from '@/lib/api';

const CATEGORIES = [
  { value: 'xray', label: 'Rentgen (X-Ray)' },
  { value: 'us', label: 'UZI (Ultratovush)' },
  { value: 'mri', label: 'MRT (MRI)' },
  { value: 'ct', label: 'KT (CT)' },
  { value: 'ecg', label: 'EKG' },
  { value: 'echo', label: 'EchoKG' },
  { value: 'eeg', label: 'EEG' },
  { value: 'emg', label: 'EMG' },
  { value: 'endoscopy', label: 'Endoskopiya' },
  { value: 'mammography', label: 'Mammografiya' },
  { value: 'densitometry', label: 'Densitometriya' },
  { value: 'spirometry', label: 'Spirometriya' },
  { value: 'audiometry', label: 'Audiometriya' },
  { value: 'other', label: 'Boshqa' },
];

const categoryLabel = (v: string) => CATEGORIES.find((c) => c.value === v)?.label ?? v;

function pickName(i18n?: Record<string, string> | null) {
  if (!i18n) return 'Nomsiz';
  return i18n['uz-Latn'] ?? i18n.uz ?? i18n.ru ?? i18n.en ?? Object.values(i18n)[0] ?? 'Nomsiz';
}

export function DiagnosticsPage() {
  const [tab, setTab] = useState<'orders' | 'equipment'>('orders');

  return (
    <div className="space-y-4">
      <PageHeader
        title="Diagnostika"
        description="Rentgen, UZI, MRT, EKG va boshqa tekshiruvlar"
      />

      <div className="inline-flex items-center rounded-lg border bg-card p-1">
        {(
          [
            { id: 'orders', label: 'Buyurtmalar' },
            { id: 'equipment', label: 'Aparatlar katalogi' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm',
              tab === t.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent',
            )}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'orders' ? <OrdersBoard /> : <EquipmentCatalog />}
    </div>
  );
}

function OrdersBoard() {
  const { data } = useQuery({
    queryKey: ['diagnostic-orders'],
    queryFn: () => api.diagnostics.listOrders(),
  });
  const items = data ?? [];

  if (items.length === 0) {
    return (
      <EmptyState
        title="Buyurtmalar yo'q"
        description="Shifokor bo'limidan ilk diagnostik buyurtmani yarating"
      />
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-4">
      {['pending', 'scheduled', 'in_progress', 'completed'].map((col) => (
        <Card key={col}>
          <CardContent className="space-y-2 p-4">
            <div className="font-semibold capitalize">{col.replace('_', ' ')}</div>
            {items
              .filter((i) => i.status === col)
              .map((it) => (
                <div key={it.id} className="rounded border p-2 text-sm">
                  <div className="font-medium">{it.name_snapshot}</div>
                  <Badge variant="outline" className="mt-1">
                    {it.urgency}
                  </Badge>
                </div>
              ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EquipmentCatalog() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(false);

  const equip = useQuery({
    queryKey: ['diagnostic-equipment'],
    queryFn: () => api.diagnostics.listEquipment(false),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.diagnostics.archiveEquipment(id),
    onSuccess: () => {
      toast.success('Arxivlandi');
      qc.invalidateQueries({ queryKey: ['diagnostic-equipment'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    const all = equip.data ?? [];
    return filter === 'all' ? all : all.filter((e) => e.category === filter);
  }, [equip.data, filter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-card p-1">
          <button
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium',
              filter === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent',
            )}
            onClick={() => setFilter('all')}
          >
            Barcha ({equip.data?.length ?? 0})
          </button>
          {CATEGORIES.map((c) => {
            const count = (equip.data ?? []).filter((e) => e.category === c.value).length;
            if (count === 0) return null;
            return (
              <button
                key={c.value}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium',
                  filter === c.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent',
                )}
                onClick={() => setFilter(c.value)}
              >
                {c.label} ({count})
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Yangi aparat
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-8 w-8" />}
          title="Aparat qo'shilmagan"
          description="Rentgen, UZI, MRT va boshqa uskunalarni ro'yxatga qo'shing"
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((e) => (
            <Card key={e.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold">{pickName(e.name_i18n)}</div>
                    <Badge variant="outline" className="mt-1">
                      {categoryLabel(e.category)}
                    </Badge>
                  </div>
                  <button
                    className="text-destructive hover:text-destructive/80"
                    onClick={() => {
                      if (window.confirm('Bu aparatni arxivlashni tasdiqlang')) archive.mutate(e.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {e.manufacturer && (
                    <div>
                      <Settings className="mr-1 inline h-3 w-3" />
                      {e.manufacturer} {e.model}
                    </div>
                  )}
                  {e.room?.name && <div>Xona: {e.room.name}</div>}
                  <div>Davomiyligi: {e.duration_min} daqiqa</div>
                  {e.price_uzs && (
                    <div className="font-medium text-foreground">
                      {Number(e.price_uzs).toLocaleString('uz-UZ')} so‘m
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {open && <CreateEquipmentDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

function CreateEquipmentDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('us');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState(30);

  const mut = useMutation({
    mutationFn: api.diagnostics.createEquipment,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['diagnostic-equipment'] });
      toast.success('Aparat qo‘shildi');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Yangi diagnostik aparat</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Nomi *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Masalan: Samsung UGEO H60" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium">Turi</label>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Davomiyligi (daq)</label>
              <Input type="number" min={5} max={480} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium">Ishlab chiqaruvchi</label>
              <Input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="Samsung, GE..." />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Model</label>
              <Input value={model} onChange={(e) => setModel(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Narx (UZS)</label>
            <Input
              type="number"
              min={0}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="100000"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button
            disabled={name.length < 2 || mut.isPending}
            onClick={() =>
              mut.mutate({
                name_i18n: { 'uz-Latn': name, ru: name, en: name },
                category,
                manufacturer: manufacturer || undefined,
                model: model || undefined,
                price_uzs: price ? Number(price) : undefined,
                duration_min: duration,
                preparation_i18n: {},
                metadata: {},
              })
            }
          >
            Qo‘shish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
