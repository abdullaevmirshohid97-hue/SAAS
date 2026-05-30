import { Input } from '@clary/ui-web';

// Analitika davr presetlari — uchala analitika sahifasida umumiy.
export type Preset = 'today' | 'week' | 'month' | 'year' | 'custom';

/** Preset/custom sanalardan API uchun query parametrlarini quradi. */
export function rangeParamsFor(
  preset: Preset,
  customFrom: string,
  customTo: string,
): { preset?: string; from?: string; to?: string } {
  return preset === 'custom' && customFrom && customTo
    ? { from: customFrom, to: customTo }
    : { preset };
}

export function PresetBar({
  value,
  onChange,
  customFrom,
  customTo,
  onFromChange,
  onToChange,
}: {
  value: Preset;
  onChange: (p: Preset) => void;
  customFrom: string;
  customTo: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}) {
  const items: Array<{ id: Preset; label: string }> = [
    { id: 'today', label: 'Bugun' },
    { id: 'week', label: 'Hafta' },
    { id: 'month', label: 'Oy' },
    { id: 'year', label: 'Yil' },
    { id: 'custom', label: 'Oraliq' },
  ];
  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
        {items.map((i) => (
          <button
            key={i.id}
            onClick={() => onChange(i.id)}
            className={
              'rounded px-3 py-1.5 text-xs font-medium transition ' +
              (value === i.id ? 'bg-background shadow-elevation-1' : 'text-muted-foreground')
            }
          >
            {i.label}
          </button>
        ))}
      </div>
      {value === 'custom' && (
        <div className="inline-flex items-center gap-1.5">
          <Input
            type="date"
            className="h-8 w-[150px]"
            value={customFrom}
            max={customTo || undefined}
            onChange={(e) => onFromChange(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">—</span>
          <Input
            type="date"
            className="h-8 w-[150px]"
            value={customTo}
            min={customFrom || undefined}
            onChange={(e) => onToChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
