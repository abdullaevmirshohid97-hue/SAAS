import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { cn } from '../utils';

// =============================================================================
// Chart — recharts ustidan temaga moslangan wrapper'lar. Ranglar global CSS
// o'zgaruvchilaridan (HSL) olinadi — light/dark/ice temalarda avtomatik
// moslashadi.
// =============================================================================

// Tema rangi — CSS o'zgaruvchisini HSL funksiyaga o'raydi.
const tone = (cssVar: string) => `hsl(var(--${cssVar}))`;

export const CHART_TONES = {
  primary: tone('primary'),
  success: tone('success'),
  warning: tone('warning'),
  danger: tone('destructive'),
  info: tone('info'),
  muted: tone('muted-foreground'),
} as const;

export type ChartTone = keyof typeof CHART_TONES;

export interface ChartSeries {
  /** Ma'lumot obyektidagi kalit. */
  key: string;
  /** Ko'rinadigan nom (tooltip/legend). */
  label: string;
  tone: ChartTone;
}

interface BaseChartProps {
  data: Array<Record<string, unknown>>;
  /** X o'qi uchun kalit. */
  xKey: string;
  series: ChartSeries[];
  height?: number;
  className?: string;
  /** Qiymatni formatlash (tooltip + Y o'qi). */
  valueFormat?: (v: number) => string;
}

// Umumiy tooltip — popover stilida, tema rangli.
function ChartTooltip({
  active,
  payload,
  label,
  valueFormat,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string | number;
  valueFormat?: (v: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      {label !== undefined && (
        <div className="mb-1 font-medium text-foreground">{String(label)}</div>
      )}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: p.color }}
          />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium text-foreground">
            {valueFormat && typeof p.value === 'number'
              ? valueFormat(p.value)
              : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

const axisProps = {
  stroke: 'hsl(var(--muted-foreground))',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

/** Maydon (area) grafigi — trend ko'rsatish uchun. */
export function AreaChartView({
  data,
  xKey,
  series,
  height = 240,
  className,
  valueFormat,
}: BaseChartProps) {
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`area-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_TONES[s.tone]} stopOpacity={0.3} />
                <stop offset="100%" stopColor={CHART_TONES[s.tone]} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey={xKey} {...axisProps} />
          <YAxis {...axisProps} width={48} />
          <Tooltip content={<ChartTooltip valueFormat={valueFormat} />} />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={CHART_TONES[s.tone]}
              strokeWidth={2}
              fill={`url(#area-${s.key})`}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Ustun (bar) grafigi. */
export function BarChartView({
  data,
  xKey,
  series,
  height = 240,
  className,
  valueFormat,
}: BaseChartProps) {
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey={xKey} {...axisProps} />
          <YAxis {...axisProps} width={48} />
          <Tooltip
            content={<ChartTooltip valueFormat={valueFormat} />}
            cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
          />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={CHART_TONES[s.tone]}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Chiziq (line) grafigi. */
export function LineChartView({
  data,
  xKey,
  series,
  height = 240,
  className,
  valueFormat,
}: BaseChartProps) {
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey={xKey} {...axisProps} />
          <YAxis {...axisProps} width={48} />
          <Tooltip content={<ChartTooltip valueFormat={valueFormat} />} />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={CHART_TONES[s.tone]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface DonutSlice {
  label: string;
  value: number;
  tone: ChartTone;
}

/** Donut (halqa) grafigi — ulush ko'rsatish uchun. */
export function DonutChartView({
  slices,
  height = 220,
  className,
  valueFormat,
}: {
  slices: DonutSlice[];
  height?: number;
  className?: string;
  valueFormat?: (v: number) => string;
}) {
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="label"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
          >
            {slices.map((s, i) => (
              <Cell key={i} fill={CHART_TONES[s.tone]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip valueFormat={valueFormat} />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
