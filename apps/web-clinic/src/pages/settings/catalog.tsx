import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Archive, Search, RotateCcw, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

import {
  Button,
  Input,
  Card,
  CardContent,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  EmptyState,
  Badge,
} from '@clary/ui-web';

import { api } from '@/lib/api';

type Row = Record<string, unknown> & {
  id: string;
  version?: number;
  is_archived?: boolean;
  is_active?: boolean;
};

type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'i18n'
  | 'time'
  | 'date'
  | 'json';

type FieldConfig = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  defaultValue?: unknown;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  showIn?: 'create' | 'update' | 'both';
};

type EntityConfig = {
  titleUz: string;
  fields: FieldConfig[];
  nameField: string;
  nameIsI18n: boolean;
  secondaryLabel?: (row: Row) => string | null;
};

const DAYS_UZ = [
  { value: '0', label: 'Yakshanba' },
  { value: '1', label: 'Dushanba' },
  { value: '2', label: 'Seshanba' },
  { value: '3', label: 'Chorshanba' },
  { value: '4', label: 'Payshanba' },
  { value: '5', label: 'Juma' },
  { value: '6', label: 'Shanba' },
];

const ENTITY_CONFIG: Record<string, EntityConfig> = {
  services: {
    titleUz: 'Xizmatlar',
    nameField: 'name_i18n',
    nameIsI18n: true,
    fields: [
      { key: 'name_i18n', label: 'Nomi', type: 'i18n', required: true },
      { key: 'price_uzs', label: 'Narxi (UZS)', type: 'number', required: true, min: 0 },
      { key: 'duration_min', label: 'Davomiyligi (min)', type: 'number', defaultValue: 30, min: 1 },
      { key: 'doctor_required', label: 'Shifokor talab etiladi', type: 'boolean', defaultValue: true },
      { key: 'is_insurance_covered', label: 'Sug‘urta qoplanadi', type: 'boolean' },
      { key: 'sku', label: 'SKU (ixtiyoriy)', type: 'text' },
    ],
    secondaryLabel: (r) => (r.price_uzs ? `${Number(r.price_uzs).toLocaleString('ru-RU')} so'm` : null),
  },
  'service-categories': {
    titleUz: 'Xizmat kategoriyalari',
    nameField: 'name_i18n',
    nameIsI18n: true,
    fields: [
      { key: 'name_i18n', label: 'Nomi', type: 'i18n', required: true },
      { key: 'icon', label: 'Ikonka (lucide nomi)', type: 'text' },
      { key: 'color', label: 'Rang (#hex)', type: 'text' },
      { key: 'sort_order', label: 'Tartib', type: 'number', defaultValue: 0 },
    ],
  },
  rooms: {
    titleUz: 'Xonalar',
    nameField: 'number',
    nameIsI18n: false,
    fields: [
      { key: 'number', label: 'Raqam', type: 'text', required: true, placeholder: '101' },
      { key: 'floor', label: 'Qavat', type: 'number' },
      { key: 'name_i18n', label: 'Nomi', type: 'i18n' },
      {
        key: 'type',
        label: 'Turi',
        type: 'select',
        options: [
          { value: 'consult', label: 'Konsultatsiya' },
          { value: 'procedure', label: 'Muolaja' },
          { value: 'ward', label: 'Palata' },
          { value: 'diagnostic', label: 'Diagnostika' },
          { value: 'lab', label: 'Laboratoriya' },
          { value: 'operating', label: 'Operatsiya' },
        ],
      },
      { key: 'capacity', label: 'Sig‘im', type: 'number', defaultValue: 1, min: 1 },
      { key: 'hourly_price_uzs', label: 'Soatlik narxi (UZS)', type: 'number' },
      { key: 'daily_price_uzs', label: 'Kunlik narxi (UZS)', type: 'number' },
    ],
    secondaryLabel: (r) => (r.floor ? `${r.floor}-qavat` : null),
  },
  'diagnostic-types': {
    titleUz: 'Diagnostika turlari',
    nameField: 'name_i18n',
    nameIsI18n: true,
    fields: [
      { key: 'category_id', label: 'Kategoriya ID (UUID)', type: 'text', required: true },
      { key: 'code', label: 'Kod', type: 'text' },
      { key: 'name_i18n', label: 'Nomi', type: 'i18n', required: true },
      { key: 'price_uzs', label: 'Narxi (UZS)', type: 'number', required: true, min: 0 },
      { key: 'duration_min', label: 'Davomiyligi (min)', type: 'number', defaultValue: 30 },
      {
        key: 'result_kind',
        label: 'Natija turi',
        type: 'select',
        defaultValue: 'report_only',
        options: [
          { value: 'report_only', label: 'Faqat xulosa' },
          { value: 'image_plus_report', label: 'Rasm + xulosa' },
          { value: 'numeric', label: 'Raqamli ko‘rsatkich' },
        ],
      },
    ],
  },
  'diagnostic-categories': {
    titleUz: 'Diagnostika kategoriyalari',
    nameField: 'name_i18n',
    nameIsI18n: true,
    fields: [
      { key: 'name_i18n', label: 'Nomi', type: 'i18n', required: true },
      { key: 'icon', label: 'Ikonka', type: 'text' },
      { key: 'sort_order', label: 'Tartib', type: 'number', defaultValue: 0 },
    ],
  },
  'diagnostic-equipment': {
    titleUz: 'Diagnostika uskunalari',
    nameField: 'name',
    nameIsI18n: false,
    fields: [
      { key: 'name', label: 'Nomi', type: 'text', required: true },
      { key: 'manufacturer', label: 'Ishlab chiqaruvchi', type: 'text' },
      { key: 'model', label: 'Model', type: 'text' },
      { key: 'serial_number', label: 'Seriya raqami', type: 'text' },
    ],
  },
  'lab-tests': {
    titleUz: 'Laboratoriya tahlillari',
    nameField: 'name_i18n',
    nameIsI18n: true,
    fields: [
      { key: 'code', label: 'Kod', type: 'text' },
      { key: 'name_i18n', label: 'Nomi', type: 'i18n', required: true },
      { key: 'price_uzs', label: 'Narxi (UZS)', type: 'number', required: true, min: 0 },
      { key: 'unit', label: 'O‘lchov birligi', type: 'text', placeholder: 'mg/dL' },
      { key: 'reference_range_male', label: 'Norma (erkak)', type: 'text' },
      { key: 'reference_range_female', label: 'Norma (ayol)', type: 'text' },
    ],
  },
  'lab-test-categories': {
    titleUz: 'Lab kategoriyalari',
    nameField: 'name_i18n',
    nameIsI18n: true,
    fields: [{ key: 'name_i18n', label: 'Nomi', type: 'i18n', required: true }],
  },
  medications: {
    titleUz: 'Dorilar',
    nameField: 'name',
    nameIsI18n: false,
    fields: [
      { key: 'name', label: 'Nomi', type: 'text', required: true },
      { key: 'manufacturer', label: 'Ishlab chiqaruvchi', type: 'text' },
      { key: 'strength', label: 'Dozasi', type: 'text', placeholder: '500 mg' },
      { key: 'form', label: 'Shakli', type: 'text', placeholder: 'tabletka' },
      { key: 'price_uzs', label: 'Narxi (UZS)', type: 'number', required: true, min: 0 },
      { key: 'stock', label: 'Ombordagi soni', type: 'number', defaultValue: 0 },
      { key: 'barcode', label: 'Shtrix-kod', type: 'text' },
    ],
  },
  'medication-categories': {
    titleUz: 'Dori kategoriyalari',
    nameField: 'name_i18n',
    nameIsI18n: true,
    fields: [{ key: 'name_i18n', label: 'Nomi', type: 'i18n', required: true }],
  },
  suppliers: {
    titleUz: 'Ta’minotchilar',
    nameField: 'name',
    nameIsI18n: false,
    fields: [
      { key: 'name', label: 'Nomi', type: 'text', required: true },
      { key: 'contact_person', label: 'Mas’ul shaxs', type: 'text' },
      { key: 'phone', label: 'Telefon', type: 'text', placeholder: '+998...' },
      { key: 'email', label: 'Email', type: 'text' },
    ],
  },
  'expense-categories': {
    titleUz: 'Xarajat kategoriyalari',
    nameField: 'name_i18n',
    nameIsI18n: true,
    fields: [
      { key: 'name_i18n', label: 'Nomi', type: 'i18n', required: true },
      { key: 'icon', label: 'Ikonka', type: 'text' },
      { key: 'color', label: 'Rang', type: 'text' },
    ],
  },
  'payment-methods': {
    titleUz: 'To‘lov usullari',
    nameField: 'name_i18n',
    nameIsI18n: true,
    fields: [
      { key: 'name_i18n', label: 'Nomi', type: 'i18n', required: true },
      {
        key: 'type',
        label: 'Turi',
        type: 'select',
        required: true,
        options: [
          { value: 'cash', label: 'Naqd' },
          { value: 'card', label: 'Karta' },
          { value: 'transfer', label: 'O‘tkazma' },
          { value: 'click', label: 'Click' },
          { value: 'payme', label: 'Payme' },
          { value: 'uzum', label: 'Uzum' },
          { value: 'humo', label: 'Humo' },
          { value: 'uzcard', label: 'Uzcard' },
          { value: 'kaspi', label: 'Kaspi' },
          { value: 'insurance', label: 'Sug‘urta' },
          { value: 'stripe', label: 'Stripe' },
        ],
      },
      { key: 'commission_percent', label: 'Komissiya (%)', type: 'number', defaultValue: 0 },
    ],
  },
  'discount-rules': {
    titleUz: 'Chegirma qoidalari',
    nameField: 'name_i18n',
    nameIsI18n: true,
    fields: [
      { key: 'name_i18n', label: 'Nomi', type: 'i18n', required: true },
      {
        key: 'type',
        label: 'Turi',
        type: 'select',
        required: true,
        options: [
          { value: 'percent', label: 'Foiz (%)' },
          { value: 'fixed', label: 'Fiksirlangan (UZS)' },
        ],
      },
      { key: 'value', label: 'Qiymati', type: 'number', required: true, min: 0 },
    ],
  },
  'insurance-companies': {
    titleUz: 'Sug‘urta kompaniyalari',
    nameField: 'name',
    nameIsI18n: false,
    fields: [
      { key: 'name', label: 'Nomi', type: 'text', required: true },
      { key: 'contract_no', label: 'Shartnoma raqami', type: 'text' },
      { key: 'commission_percent', label: 'Komissiya (%)', type: 'number', defaultValue: 0 },
    ],
  },
  'referral-partners': {
    titleUz: 'Yo‘llanma sheriklari',
    nameField: 'name',
    nameIsI18n: false,
    fields: [
      { key: 'name', label: 'Nomi', type: 'text', required: true },
      { key: 'type', label: 'Turi', type: 'text' },
      { key: 'commission_percent', label: 'Komissiya (%)', type: 'number', defaultValue: 0 },
    ],
  },
  'document-templates': {
    titleUz: 'Hujjat shablonlari',
    nameField: 'name_i18n',
    nameIsI18n: true,
    fields: [
      {
        key: 'kind',
        label: 'Turi',
        type: 'select',
        required: true,
        options: [
          { value: 'receipt', label: 'Chek' },
          { value: 'prescription', label: 'Retsept' },
          { value: 'certificate', label: 'Guvohnoma' },
          { value: 'invoice', label: 'Hisob-faktura' },
          { value: 'discharge_summary', label: 'Chiqish xulosasi' },
        ],
      },
      { key: 'name_i18n', label: 'Nomi', type: 'i18n', required: true },
      { key: 'content_html_i18n', label: 'HTML tarkibi (i18n)', type: 'i18n', required: true },
    ],
  },
  'sms-templates': {
    titleUz: 'SMS shablonlari',
    nameField: 'key',
    nameIsI18n: false,
    fields: [
      { key: 'key', label: 'Kalit', type: 'text', required: true, placeholder: 'appointment.reminder' },
      { key: 'content_i18n', label: 'Matn (i18n)', type: 'i18n', required: true },
      { key: 'trigger_event', label: 'Trigger hodisa', type: 'text' },
    ],
  },
  'email-templates': {
    titleUz: 'Email shablonlari',
    nameField: 'key',
    nameIsI18n: false,
    fields: [
      { key: 'key', label: 'Kalit', type: 'text', required: true },
      { key: 'subject_i18n', label: 'Sarlavha (i18n)', type: 'i18n', required: true },
      { key: 'content_html_i18n', label: 'HTML (i18n)', type: 'i18n', required: true },
      { key: 'trigger_event', label: 'Trigger hodisa', type: 'text' },
    ],
  },
  'working-hours': {
    titleUz: 'Ish vaqti',
    nameField: 'day_of_week',
    nameIsI18n: false,
    fields: [
      { key: 'day_of_week', label: 'Kun', type: 'select', required: true, options: DAYS_UZ },
      { key: 'open_from', label: 'Ochilish (HH:MM)', type: 'time', placeholder: '09:00' },
      { key: 'close_to', label: 'Yopilish (HH:MM)', type: 'time', placeholder: '18:00' },
      { key: 'is_closed', label: 'Yopiq kun', type: 'boolean' },
    ],
    secondaryLabel: (r) => {
      const d = Number(r.day_of_week);
      return DAYS_UZ[d]?.label ?? null;
    },
  },
  holidays: {
    titleUz: 'Bayramlar va dam olish kunlari',
    nameField: 'name_i18n',
    nameIsI18n: true,
    fields: [
      { key: 'date', label: 'Sana (YYYY-MM-DD)', type: 'date', required: true },
      { key: 'name_i18n', label: 'Nomi', type: 'i18n', required: true },
      { key: 'is_closed', label: 'Yopiq', type: 'boolean', defaultValue: true },
      { key: 'recurring_yearly', label: 'Har yili takrorlanadi', type: 'boolean' },
    ],
  },
  'custom-roles': {
    titleUz: 'Maxsus rollar',
    nameField: 'name',
    nameIsI18n: false,
    fields: [
      { key: 'name', label: 'Nomi', type: 'text', required: true },
      { key: 'description', label: 'Izoh', type: 'textarea' },
      {
        key: 'base_role',
        label: 'Asosiy rol',
        type: 'select',
        defaultValue: 'staff',
        options: [
          { value: 'staff', label: 'Xodim' },
          { value: 'doctor', label: 'Shifokor' },
          { value: 'nurse', label: 'Hamshira' },
          { value: 'reception', label: 'Resepshn' },
          { value: 'cashier', label: 'Kassir' },
          { value: 'pharmacist', label: 'Farmatsevt' },
          { value: 'lab_tech', label: 'Lab texnigi' },
          { value: 'admin', label: 'Administrator' },
        ],
      },
    ],
  },
  'marketing-segments': {
    titleUz: 'Marketing segmentlari',
    nameField: 'name',
    nameIsI18n: false,
    fields: [
      { key: 'name', label: 'Nomi', type: 'text', required: true },
      { key: 'description', label: 'Izoh', type: 'textarea' },
      { key: 'is_dynamic', label: 'Dinamik (avtomatik yangilanadi)', type: 'boolean', defaultValue: true },
    ],
  },
  'loyalty-rules': {
    titleUz: 'Loyalti qoidalari',
    nameField: 'name',
    nameIsI18n: false,
    fields: [
      { key: 'name', label: 'Nomi', type: 'text', required: true },
      { key: 'trigger_event', label: 'Trigger hodisa', type: 'text', required: true },
      { key: 'points_awarded', label: 'Ball', type: 'number', required: true },
    ],
  },
  'room-tariffs': {
    titleUz: 'Xona tariflari',
    nameField: 'tariff_name',
    nameIsI18n: false,
    fields: [
      { key: 'room_id', label: 'Xona ID (UUID)', type: 'text', required: true },
      { key: 'tariff_name', label: 'Tarif nomi', type: 'text', required: true },
      { key: 'price_uzs', label: 'Narxi (UZS)', type: 'number', required: true, min: 0 },
      {
        key: 'duration_unit',
        label: 'Vaqt birligi',
        type: 'select',
        defaultValue: 'day',
        options: [
          { value: 'hour', label: 'Soat' },
          { value: 'day', label: 'Kun' },
          { value: 'week', label: 'Hafta' },
        ],
      },
    ],
  },
  'diagnostic-preparations': {
    titleUz: 'Diagnostika tayyorgarlik',
    nameField: 'name_i18n',
    nameIsI18n: true,
    fields: [
      { key: 'name_i18n', label: 'Nomi', type: 'i18n', required: true },
      { key: 'instructions_i18n', label: 'Yo‘riqnoma (i18n)', type: 'i18n', required: true },
      { key: 'duration_before_hours', label: 'Oldindan (soat)', type: 'number' },
    ],
  },
};

const DEFAULT_CONFIG: EntityConfig = {
  titleUz: 'Katalog',
  nameField: 'name',
  nameIsI18n: false,
  fields: [{ key: 'name', label: 'Nomi', type: 'text', required: true }],
};

function getName(row: Row, field: string, isI18n: boolean): string {
  const v = row[field];
  if (v == null) return '—';
  if (isI18n && typeof v === 'object') {
    const rec = v as Record<string, string>;
    return rec['uz-Latn'] ?? rec['uz'] ?? rec['ru'] ?? rec['en'] ?? Object.values(rec)[0] ?? '—';
  }
  return String(v);
}

export function SettingsCatalogPage() {
  const { entity = 'services' } = useParams();
  const qc = useQueryClient();
  const cfg = ENTITY_CONFIG[entity] ?? DEFAULT_CONFIG;

  const [q, setQ] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  const listQuery = useQuery({
    queryKey: ['catalog', entity, { q, includeArchived }],
    queryFn: () =>
      api.catalog.list(entity, {
        page: 1,
        pageSize: 200,
        q: q || undefined,
        include_archived: includeArchived ? 'true' : undefined,
      }),
  });

  const rawItems = ((listQuery.data as { items?: Row[] } | undefined)?.items ?? []) as Row[];
  const items = useMemo(() => {
    if (!q) return rawItems;
    const needle = q.toLowerCase();
    return rawItems.filter((r) => getName(r, cfg.nameField, cfg.nameIsI18n).toLowerCase().includes(needle));
  }, [rawItems, q, cfg.nameField, cfg.nameIsI18n]);

  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const resetForm = () => {
    const defaults: Record<string, unknown> = {};
    for (const f of cfg.fields) {
      if (f.defaultValue !== undefined) defaults[f.key] = f.defaultValue;
    }
    setPayload(defaults);
    setErrors({});
  };

  const openCreate = () => {
    resetForm();
    setOpen(true);
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    for (const f of cfg.fields) {
      if (!f.required) continue;
      const v = payload[f.key];
      if (f.type === 'i18n') {
        const rec = v as Record<string, string> | undefined;
        if (!rec || !rec['uz-Latn']) errs[f.key] = 'O‘zbekcha (lotin) majburiy';
      } else if (v == null || v === '') {
        errs[f.key] = 'Majburiy maydon';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const createMut = useMutation({
    mutationFn: () => api.catalog.create(entity, payload),
    onSuccess: () => {
      toast.success('Muvaffaqiyatli saqlandi');
      setOpen(false);
      resetForm();
      qc.invalidateQueries({ queryKey: ['catalog', entity] });
    },
    onError: (e: Error) => {
      toast.error(e.message || 'Saqlashda xatolik');
    },
  });

  const archiveMut = useMutation({
    mutationFn: (id: string) => api.catalog.archive(entity, id),
    onSuccess: () => {
      toast.success('Arxivlandi');
      qc.invalidateQueries({ queryKey: ['catalog', entity] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const restoreMut = useMutation({
    mutationFn: (id: string) => api.catalog.restore(entity, id),
    onSuccess: () => {
      toast.success('Tiklandi');
      qc.invalidateQueries({ queryKey: ['catalog', entity] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = () => {
    if (!validate()) {
      toast.error('Majburiy maydonlar to‘ldirilmagan');
      return;
    }
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (v === '' || v == null) continue;
      cleaned[k] = v;
    }
    createMut.mutate();
    void cleaned;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{cfg.titleUz}</h2>
          <p className="text-sm text-muted-foreground">
            Jami: {rawItems.length} yozuv
            {listQuery.isError ? ' • Yuklashda xatolik' : ''}
          </p>
        </div>
        <Sheet open={open} onOpenChange={(v) => (v ? openCreate() : setOpen(false))}>
          <SheetTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Yangi
            </Button>
          </SheetTrigger>
          <SheetContent className="overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Yangi yozuv — {cfg.titleUz}</SheetTitle>
            </SheetHeader>
            <div className="space-y-4 pt-4">
              {cfg.fields
                .filter((f) => f.showIn !== 'update')
                .map((f) => (
                  <DynamicField
                    key={f.key}
                    field={f}
                    value={payload[f.key]}
                    error={errors[f.key]}
                    onChange={(v) => setPayload((p) => ({ ...p, [f.key]: v }))}
                  />
                ))}

              {createMut.isError && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{(createMut.error as Error)?.message ?? 'Server xatosi'}</span>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>
                  Bekor qilish
                </Button>
                <Button className="flex-1" onClick={submit} disabled={createMut.isPending}>
                  {createMut.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Qidirish…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Arxivlanganlarni ko‘rsatish
        </label>
      </div>

      {listQuery.isLoading ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">Yuklanmoqda…</CardContent>
        </Card>
      ) : listQuery.isError ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-destructive">
            Yuklashda xatolik: {(listQuery.error as Error)?.message ?? '—'}
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <EmptyState title="Bo‘sh" description="Birinchi yozuvni qo‘shing" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="p-3">Nomi</th>
                  <th className="p-3">Qo‘shimcha</th>
                  <th className="p-3">Versiya</th>
                  <th className="p-3 text-right">Amal</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => {
                  const name = getName(r, cfg.nameField, cfg.nameIsI18n);
                  const secondary = cfg.secondaryLabel?.(r) ?? null;
                  return (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-accent/50">
                      <td className="p-3 font-medium">
                        {name}
                        {r.is_archived ? (
                          <Badge variant="secondary" className="ml-2">
                            Arxivlangan
                          </Badge>
                        ) : null}
                      </td>
                      <td className="p-3 text-muted-foreground">{secondary ?? '—'}</td>
                      <td className="p-3 text-muted-foreground">v{r.version ?? 1}</td>
                      <td className="p-3 text-right">
                        {r.is_archived ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => restoreMut.mutate(r.id)}
                            disabled={restoreMut.isPending}
                          >
                            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Tiklash
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (window.confirm(`"${name}" arxivlansinmi?`)) archiveMut.mutate(r.id);
                            }}
                            disabled={archiveMut.isPending}
                          >
                            <Archive className="mr-1 h-3.5 w-3.5" /> Arxiv
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DynamicField({
  field,
  value,
  error,
  onChange,
}: {
  field: FieldConfig;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
}) {
  const labelNode = (
    <div className="flex items-center justify-between">
      <label className="text-sm font-medium">
        {field.label}
        {field.required && <span className="ml-1 text-destructive">*</span>}
      </label>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );

  if (field.type === 'i18n') {
    const rec = (value as Record<string, string> | undefined) ?? {};
    return (
      <div className="space-y-2">
        {labelNode}
        <div className="grid gap-2">
          <Input
            placeholder="O‘zbekcha (lotin) *"
            value={rec['uz-Latn'] ?? ''}
            onChange={(e) => onChange({ ...rec, 'uz-Latn': e.target.value })}
          />
          <Input
            placeholder="Русский"
            value={rec.ru ?? ''}
            onChange={(e) => onChange({ ...rec, ru: e.target.value })}
          />
          <Input
            placeholder="English"
            value={rec.en ?? ''}
            onChange={(e) => onChange({ ...rec, en: e.target.value })}
          />
        </div>
        {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
      </div>
    );
  }

  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        {field.label}
      </label>
    );
  }

  if (field.type === 'select') {
    return (
      <div className="space-y-1">
        {labelNode}
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— tanlang —</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div className="space-y-1">
        {labelNode}
        <textarea
          className="min-h-[80px] w-full rounded-md border border-input bg-background p-2 text-sm"
          placeholder={field.placeholder}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (field.type === 'number') {
    return (
      <div className="space-y-1">
        {labelNode}
        <Input
          type="number"
          min={field.min}
          placeholder={field.placeholder}
          value={(value as number | string) ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === '' ? undefined : Number(raw));
          }}
        />
      </div>
    );
  }

  if (field.type === 'time') {
    return (
      <div className="space-y-1">
        {labelNode}
        <Input
          type="time"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (field.type === 'date') {
    return (
      <div className="space-y-1">
        {labelNode}
        <Input
          type="date"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {labelNode}
      <Input
        placeholder={field.placeholder}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
