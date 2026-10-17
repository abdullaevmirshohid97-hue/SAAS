import { useMemo } from 'react';
import type { EntitlementCatalog, EntitlementsData, EntitlementsPatch } from '@clary/api-client';
import { Badge, Input, Tabs, TabsContent, TabsList, TabsTrigger, cn } from '@clary/ui-web';
import {
  BarChart3,
  BookText,
  Boxes,
  CreditCard,
  Gauge,
  MonitorSmartphone,
  RotateCcw,
} from 'lucide-react';

import { applyPatch, clone } from './ent-utils';

// =============================================================================
// Tarif imkoniyatlari muharriri — ikki rejim:
//   plan     — tarifning to'liq qiymati (har maydon Ha/Yo'q)
//   override — klinikaga individual: har maydon "Tarifdagidek" yoki aniq qiymat
// =============================================================================

type Path = readonly string[];

interface CommonProps {
  catalog: EntitlementCatalog;
}
interface PlanProps extends CommonProps {
  mode: 'plan';
  value: EntitlementsData;
  onChange: (v: EntitlementsData) => void;
}
interface OverrideProps extends CommonProps {
  mode: 'override';
  base: EntitlementsData;
  patch: EntitlementsPatch;
  onChange: (p: EntitlementsPatch) => void;
}
export type EntitlementsEditorProps = PlanProps | OverrideProps;

function getAt(obj: unknown, path: Path): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}
function hasAt(obj: unknown, path: Path): boolean {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur == null || typeof cur !== 'object' || !(k in (cur as object))) return false;
    cur = (cur as Record<string, unknown>)[k];
  }
  return true;
}
function setAt<T extends object>(obj: T, path: Path, value: unknown): T {
  const out = clone(obj) as Record<string, unknown>;
  let cur = out;
  path.forEach((k, i) => {
    if (i === path.length - 1) {
      cur[k] = value;
    } else {
      if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
      cur = cur[k] as Record<string, unknown>;
    }
  });
  return out as T;
}
function unsetAt<T extends object>(obj: T, path: Path): T {
  const out = clone(obj) as Record<string, unknown>;
  const parents: Array<[Record<string, unknown>, string]> = [];
  let cur: Record<string, unknown> | undefined = out;
  for (let i = 0; i < path.length - 1; i++) {
    const next = cur?.[path[i]!];
    if (next == null || typeof next !== 'object') return out as T;
    parents.push([cur!, path[i]!]);
    cur = next as Record<string, unknown>;
  }
  if (cur) delete cur[path[path.length - 1]!];
  // Bo'shab qolgan ota obyektlarni tozalash
  for (let i = parents.length - 1; i >= 0; i--) {
    const [p, k] = parents[i]!;
    if (Object.keys(p[k] as object).length === 0) delete p[k];
  }
  return out as T;
}

export function EntitlementsEditor(props: EntitlementsEditorProps) {
  const { catalog } = props;
  const isOverride = props.mode === 'override';
  const effective = useMemo(
    () => (props.mode === 'plan' ? props.value : applyPatch(props.base, props.patch)),
    [props],
  );

  const api = {
    value: (path: Path) => getAt(effective, path),
    inherited: (path: Path) => (props.mode === 'override' ? getAt(props.base, path) : undefined),
    overridden: (path: Path) => (props.mode === 'override' ? hasAt(props.patch, path) : false),
    set: (path: Path, v: unknown) => {
      if (props.mode === 'plan') props.onChange(setAt(props.value, path, v));
      else props.onChange(setAt(props.patch, path, v));
    },
    reset: (path: Path) => {
      if (props.mode === 'override') props.onChange(unsetAt(props.patch, path));
    },
  };

  const groups = catalog.groups.filter((g) => g.key !== 'analytics');
  const analytics = catalog.modules.filter((m) => m.group === 'analytics');
  const moduleCount = (keys: string[]) =>
    keys.filter((k) => getAt(effective, ['modules', k]) !== false).length;

  const setGroup = (keys: string[], v: boolean) => {
    if (props.mode === 'plan') {
      const next = clone(props.value);
      for (const k of keys) next.modules[k] = v;
      props.onChange(next);
    } else {
      const next = clone(props.patch);
      next.modules = { ...(next.modules ?? {}) };
      for (const k of keys) next.modules[k] = v;
      props.onChange(next);
    }
  };
  const resetGroup = (keys: string[]) => {
    if (props.mode !== 'override') return;
    const next = clone(props.patch);
    for (const k of keys) delete next.modules?.[k];
    if (next.modules && Object.keys(next.modules).length === 0) delete next.modules;
    props.onChange(next);
  };

  return (
    <Tabs defaultValue="modules" className="space-y-3">
      <TabsList className="flex h-auto w-full flex-wrap justify-start">
        <TabsTrigger value="modules" className="gap-1.5">
          <Boxes className="h-3.5 w-3.5" /> Modullar
          <Badge variant="outline" className="ml-1 px-1.5 py-0 text-[10px]">
            {moduleCount(catalog.modules.filter((m) => m.group !== 'analytics').map((m) => m.key))}/
            {catalog.modules.filter((m) => m.group !== 'analytics').length}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="analytics" className="gap-1.5">
          <BarChart3 className="h-3.5 w-3.5" /> Analitika
          <Badge variant="outline" className="ml-1 px-1.5 py-0 text-[10px]">
            {moduleCount(analytics.map((m) => m.key))}/{analytics.length}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="journal" className="gap-1.5">
          <BookText className="h-3.5 w-3.5" /> Jurnal
        </TabsTrigger>
        <TabsTrigger value="payments" className="gap-1.5">
          <CreditCard className="h-3.5 w-3.5" /> To‘lov turlari
        </TabsTrigger>
        <TabsTrigger value="access" className="gap-1.5">
          <MonitorSmartphone className="h-3.5 w-3.5" /> Rollar va qurilmalar
        </TabsTrigger>
        {isOverride && (
          <TabsTrigger value="limits" className="gap-1.5">
            <Gauge className="h-3.5 w-3.5" /> Limitlar
          </TabsTrigger>
        )}
      </TabsList>

      {/* ── Modullar ─────────────────────────────────────────────────── */}
      <TabsContent value="modules" className="space-y-4">
        {groups.map((g) => {
          const mods = catalog.modules.filter((m) => m.group === g.key);
          const keys = mods.map((m) => m.key);
          return (
            <ModuleGroup
              key={g.key}
              title={g.label}
              count={`${moduleCount(keys)}/${keys.length}`}
              onAll={(v) => setGroup(keys, v)}
              onReset={isOverride ? () => resetGroup(keys) : undefined}
            >
              {mods.map((m) => (
                <BoolField
                  key={m.key}
                  api={api}
                  mode={props.mode}
                  path={['modules', m.key]}
                  label={m.label}
                  description={m.description}
                  defaultValue
                />
              ))}
            </ModuleGroup>
          );
        })}
      </TabsContent>

      {/* ── Analitika ────────────────────────────────────────────────── */}
      <TabsContent value="analytics" className="space-y-4">
        <ModuleGroup
          title="Analitika va hisobotlar"
          count={`${moduleCount(analytics.map((m) => m.key))}/${analytics.length}`}
          onAll={(v) =>
            setGroup(
              analytics.map((m) => m.key),
              v,
            )
          }
          onReset={isOverride ? () => resetGroup(analytics.map((m) => m.key)) : undefined}
          note="Dashboard'dagi asosiy ko‘rsatkichlar (tushum, bemorlar, navbat) har doim ochiq. Yopilgan bo‘limlar menyudan yo‘qoladi va API darajasida ham bloklanadi."
        >
          {analytics.map((m) => (
            <BoolField
              key={m.key}
              api={api}
              mode={props.mode}
              path={['modules', m.key]}
              label={m.label}
              description={m.description}
              defaultValue
            />
          ))}
          <BoolField
            api={api}
            mode={props.mode}
            path={['journal', 'allow_export']}
            label="Eksport (CSV / Excel)"
            description="Jurnal va hisobotlarni faylga yuklab olish"
            defaultValue
          />
        </ModuleGroup>
      </TabsContent>

      {/* ── Jurnal ───────────────────────────────────────────────────── */}
      <TabsContent value="journal" className="space-y-3">
        <Panel title="Jurnal cheklovlari">
          <NumberField
            api={api}
            mode={props.mode}
            path={['journal', 'history_days']}
            label="Tarix chuqurligi (kun)"
            description="Jurnal va kunlik hisobotda necha kun orqaga ko‘rinadi. Bo‘sh — cheksiz."
            min={1}
            max={3650}
          />
          <BoolField
            api={api}
            mode={props.mode}
            path={['journal', 'allow_edit']}
            label="Yozuvni tahrirlash"
            description="Xizmatlar, summa, shifokor va to‘lov usulini o‘zgartirish"
            defaultValue
          />
          <BoolField
            api={api}
            mode={props.mode}
            path={['journal', 'allow_delete']}
            label="O‘chirish va bekor qilish"
            description="Yozuvni savatchaga o‘chirish yoki bekor qilish (void)"
            defaultValue
          />
          <BoolField
            api={api}
            mode={props.mode}
            path={['journal', 'allow_export']}
            label="Eksport (CSV)"
            description="Jurnalni faylga yuklab olish"
            defaultValue
          />
        </Panel>
      </TabsContent>

      {/* ── To'lov turlari ───────────────────────────────────────────── */}
      <TabsContent value="payments" className="space-y-3">
        <ListField
          api={api}
          mode={props.mode}
          path={['payments', 'methods']}
          title="Ruxsat etilgan to‘lov turlari"
          allLabel="Barcha to‘lov turlari"
          options={catalog.payment_methods}
          note="Cheklov bazada ham ishlaydi: ro‘yxatda yo‘q usul bilan to‘lov qabul qilinmaydi (kassa, qabulxona, dorixona, statsionar). Aralash to‘lovning har bir qismi alohida tekshiriladi."
        />
      </TabsContent>

      {/* ── Rollar va qurilmalar ─────────────────────────────────────── */}
      <TabsContent value="access" className="space-y-3">
        <ListField
          api={api}
          mode={props.mode}
          path={['roles', 'allowed']}
          title="Ruxsat etilgan rollar"
          allLabel="Barcha rollar"
          options={catalog.roles}
          note="Klinika egasi har doim mumkin. Ro‘yxatda yo‘q rol bilan yangi xodim qo‘shib bo‘lmaydi; mavjud xodimlar ishlayveradi."
        />
        <Panel title="Rollar">
          <BoolField
            api={api}
            mode={props.mode}
            path={['roles', 'custom_roles']}
            label="Maxsus rollar"
            description="Klinika o‘z ruxsatlar to‘plamidan rol yarata oladi"
            defaultValue
          />
        </Panel>
        <Panel title="Qurilmalar va ilovalar">
          {catalog.clients.map((c) => (
            <BoolField
              key={c.key}
              api={api}
              mode={props.mode}
              path={['devices', 'clients', c.key]}
              label={c.label}
              description={
                c.key === 'web'
                  ? 'app.clary.uz orqali brauzerdan ishlash'
                  : c.key === 'desktop'
                    ? 'Windows ilovasi (jim chop etish, printerlar)'
                    : c.key === 'mobile'
                      ? 'Xodimlar mobil ilovasi'
                      : 'Navbat kioski va TV ekran'
              }
              defaultValue
            />
          ))}
          <BoolField
            api={api}
            mode={props.mode}
            path={['devices', 'enforce_limit']}
            label="Qurilmalar sonini qat’iy cheklash"
            description="Yoqilsa, limit to‘lganda yangi kompyuter/telefon kira olmaydi (eskisini o‘chirish kerak). O‘chiq — faqat hisobga olinadi."
            defaultValue={false}
          />
        </Panel>
      </TabsContent>

      {/* ── Limitlar (faqat individual) ──────────────────────────────── */}
      {isOverride && (
        <TabsContent value="limits" className="space-y-3">
          <Panel title="Klinika limitlari">
            <NumberField
              api={api}
              mode={props.mode}
              path={['limits', 'max_staff']}
              label="Xodimlar soni"
              description="Faol login akkauntlar. Bo‘sh — cheksiz."
              min={0}
              max={100000}
            />
            <NumberField
              api={api}
              mode={props.mode}
              path={['limits', 'max_devices']}
              label="Qurilmalar soni"
              description="Bloklanmagan qurilmalar (qat’iy cheklash yoqilgan bo‘lsa)."
              min={0}
              max={100000}
            />
            <NumberField
              api={api}
              mode={props.mode}
              path={['limits', 'max_patients']}
              label="Bemorlar soni"
              description="Bazadagi faol bemorlar. Bo‘sh — cheksiz."
              min={0}
              max={1000000}
            />
          </Panel>
        </TabsContent>
      )}
    </Tabs>
  );
}

// ── Kichik bloklar ──────────────────────────────────────────────────────────

type Api = {
  value: (p: Path) => unknown;
  inherited: (p: Path) => unknown;
  overridden: (p: Path) => boolean;
  set: (p: Path, v: unknown) => void;
  reset: (p: Path) => void;
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border">
      <div className="bg-muted/30 border-b px-4 py-2.5 text-sm font-semibold">{title}</div>
      <div className="divide-y">{children}</div>
    </div>
  );
}

function ModuleGroup({
  title,
  count,
  onAll,
  onReset,
  note,
  children,
}: {
  title: string;
  count: string;
  onAll: (v: boolean) => void;
  onReset?: () => void;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border">
      <div className="bg-muted/30 flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <span className="text-sm font-semibold">{title}</span>
        <Badge variant="outline" className="text-[10px]">
          {count}
        </Badge>
        <div className="ml-auto flex gap-1">
          <MiniBtn onClick={() => onAll(true)}>Hammasi yoqilsin</MiniBtn>
          <MiniBtn onClick={() => onAll(false)}>Hammasi o‘chirilsin</MiniBtn>
          {onReset && (
            <MiniBtn onClick={onReset}>
              <RotateCcw className="mr-1 inline h-3 w-3" />
              Tarifdagidek
            </MiniBtn>
          )}
        </div>
      </div>
      {note && <p className="text-muted-foreground border-b px-4 py-2 text-xs">{note}</p>}
      <div className="grid divide-y sm:grid-cols-2 sm:divide-y-0">{children}</div>
    </div>
  );
}

function MiniBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-md border px-2 py-1 text-[11px] font-medium"
    >
      {children}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-emerald-500' : 'bg-muted-foreground/30',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

/** Override rejimida: Tarifdagidek / Ha / Yo'q */
function Tri({
  overridden,
  value,
  inherited,
  onSet,
  onReset,
}: {
  overridden: boolean;
  value: boolean;
  inherited: boolean;
  onSet: (v: boolean) => void;
  onReset: () => void;
}) {
  const btn = (active: boolean, tone: string) =>
    cn(
      'px-2 py-1 text-[11px] font-medium transition-colors',
      active ? tone : 'text-muted-foreground hover:bg-accent',
    );
  return (
    <div className="inline-flex shrink-0 overflow-hidden rounded-md border">
      <button
        type="button"
        onClick={onReset}
        className={btn(!overridden, 'bg-muted text-foreground')}
        title="Tarifdagi qiymat"
      >
        Tarif ({inherited ? 'Ha' : 'Yo‘q'})
      </button>
      <button
        type="button"
        onClick={() => onSet(true)}
        className={cn(btn(overridden && value, 'bg-emerald-500 text-white'), 'border-l')}
      >
        Ha
      </button>
      <button
        type="button"
        onClick={() => onSet(false)}
        className={cn(btn(overridden && !value, 'bg-rose-500 text-white'), 'border-l')}
      >
        Yo‘q
      </button>
    </div>
  );
}

function BoolField({
  api,
  mode,
  path,
  label,
  description,
  defaultValue,
}: {
  api: Api;
  mode: 'plan' | 'override';
  path: Path;
  label: string;
  description?: string;
  defaultValue: boolean;
}) {
  const raw = api.value(path);
  const value = typeof raw === 'boolean' ? raw : defaultValue;
  const inh = api.inherited(path);
  const inherited = typeof inh === 'boolean' ? inh : defaultValue;
  const overridden = api.overridden(path);
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3',
        mode === 'override' && overridden && 'bg-amber-500/5',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className={cn('text-sm font-medium', !value && 'text-muted-foreground line-through')}>
          {label}
        </div>
        {description && (
          <div className="text-muted-foreground mt-0.5 text-xs leading-snug">{description}</div>
        )}
      </div>
      {mode === 'plan' ? (
        <Switch checked={value} onChange={(v) => api.set(path, v)} />
      ) : (
        <Tri
          overridden={overridden}
          value={value}
          inherited={inherited}
          onSet={(v) => api.set(path, v)}
          onReset={() => api.reset(path)}
        />
      )}
    </div>
  );
}

function NumberField({
  api,
  mode,
  path,
  label,
  description,
  min,
  max,
}: {
  api: Api;
  mode: 'plan' | 'override';
  path: Path;
  label: string;
  description?: string;
  min: number;
  max: number;
}) {
  const raw = api.value(path);
  const value = typeof raw === 'number' ? raw : null;
  const inh = api.inherited(path);
  const overridden = api.overridden(path);
  const editable = mode === 'plan' || overridden;
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 px-4 py-3',
        mode === 'override' && overridden && 'bg-amber-500/5',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-muted-foreground mt-0.5 text-xs">{description}</div>}
      </div>
      {mode === 'override' && (
        <label className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={!overridden}
            onChange={(e) => (e.target.checked ? api.reset(path) : api.set(path, inh ?? null))}
          />
          Tarifdagidek ({typeof inh === 'number' ? inh : 'cheksiz'})
        </label>
      )}
      <Input
        type="number"
        min={min}
        max={max}
        disabled={!editable}
        placeholder="cheksiz"
        className="h-8 w-32"
        value={value ?? ''}
        onChange={(e) => {
          const v = e.target.value.trim();
          api.set(path, v === '' ? null : Math.max(min, Math.min(max, Math.floor(Number(v)))));
        }}
      />
    </div>
  );
}

function ListField({
  api,
  mode,
  path,
  title,
  allLabel,
  options,
  note,
}: {
  api: Api;
  mode: 'plan' | 'override';
  path: Path;
  title: string;
  allLabel: string;
  options: ReadonlyArray<{ key: string; label: string }>;
  note?: string;
}) {
  const raw = api.value(path);
  const list = Array.isArray(raw) ? (raw as string[]) : null;
  const overridden = api.overridden(path);
  const inh = api.inherited(path);
  const editable = mode === 'plan' || overridden;
  const toggle = (key: string) => {
    const cur = list ?? options.map((o) => o.key);
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    api.set(path, next);
  };
  return (
    <div
      className={cn(
        'rounded-xl border',
        mode === 'override' && overridden && 'border-amber-500/40',
      )}
    >
      <div className="bg-muted/30 flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
        <span className="text-sm font-semibold">{title}</span>
        {mode === 'override' && (
          <label className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={!overridden}
              onChange={(e) =>
                e.target.checked ? api.reset(path) : api.set(path, Array.isArray(inh) ? inh : null)
              }
            />
            Tarifdagidek ({Array.isArray(inh) ? `${inh.length} ta` : 'hammasi'})
          </label>
        )}
        <label className="ml-auto inline-flex items-center gap-2 text-xs font-medium">
          {allLabel}
          <Switch
            checked={list === null}
            disabled={!editable}
            onChange={(v) => api.set(path, v ? null : options.map((o) => o.key))}
          />
        </label>
      </div>
      {note && <p className="text-muted-foreground border-b px-4 py-2 text-xs">{note}</p>}
      <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((o) => {
          const on = list === null || list.includes(o.key);
          return (
            <button
              key={o.key}
              type="button"
              disabled={!editable || list === null}
              onClick={() => toggle(o.key)}
              className={cn(
                'flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed',
                on
                  ? 'text-foreground border-emerald-500/40 bg-emerald-500/5'
                  : 'text-muted-foreground hover:bg-accent/50',
                list === null && 'opacity-70',
              )}
            >
              <span>{o.label}</span>
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  on ? 'bg-emerald-500' : 'bg-muted-foreground/30',
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
