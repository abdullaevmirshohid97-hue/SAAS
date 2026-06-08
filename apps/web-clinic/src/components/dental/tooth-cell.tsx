import { cn } from '@clary/ui-web';

import {
  ABSENT_STATUSES,
  SURFACE_COLOR,
  TOOTH_STATUS_COLOR,
  surfaceMapForTooth,
  type SurfaceKey,
} from './dental-constants';

// Bitta tish — 5 zonali (mesial/distal/buccal/lingual/okklyuzion) diagramma.
// Har zona yuza sharti (caries/filling/sealant) bo'yicha ranglanadi.
// Butun-tish holati ramka rangi + (yo'q bo'lsa) X belgisi orqali ko'rinadi.
export function ToothCell({
  fdi,
  surfaces,
  status,
  selected,
  onPick,
}: {
  fdi: number;
  surfaces: Record<string, string>;
  status: string;
  selected: boolean;
  onPick: (surface: SurfaceKey) => void;
}) {
  const map = surfaceMapForTooth(fdi);
  const fill = (zone: 'top' | 'right' | 'bottom' | 'left' | 'center') => {
    const cond = surfaces?.[map[zone]] ?? '';
    return SURFACE_COLOR[cond] ?? '#ffffff';
  };
  const isAbsent = ABSENT_STATUSES.has(status);
  const statusColor = status && status !== 'sound' ? TOOTH_STATUS_COLOR[status] ?? '#94a3b8' : '#cbd5e1';

  const zone = (
    points: string,
    z: 'top' | 'right' | 'bottom' | 'left' | 'center',
  ) => (
    <polygon
      points={points}
      fill={fill(z)}
      stroke="#cbd5e1"
      strokeWidth={0.8}
      className="cursor-pointer transition-[fill] hover:opacity-80"
      onClick={(e) => {
        e.stopPropagation();
        onPick(map[z]);
      }}
    >
      <title>{map[z]}</title>
    </polygon>
  );

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg
        viewBox="0 0 44 44"
        width={40}
        height={40}
        className={cn(
          'rounded-md ring-offset-1 transition-shadow',
          selected && 'ring-2 ring-primary ring-offset-1',
        )}
        style={{ background: statusColor === '#cbd5e1' ? 'transparent' : `${statusColor}22` }}
      >
        {/* status ramkasi */}
        <rect x={1} y={1} width={42} height={42} rx={4} fill="none" stroke={statusColor} strokeWidth={status && status !== 'sound' ? 2 : 1} />
        {zone('3,3 41,3 30,14 14,14', 'top')}
        {zone('41,3 41,41 30,30 30,14', 'right')}
        {zone('41,41 3,41 14,30 30,30', 'bottom')}
        {zone('3,41 3,3 14,14 14,30', 'left')}
        {zone('14,14 30,14 30,30 14,30', 'center')}
        {isAbsent && (
          <g stroke="#6b7280" strokeWidth={2.5} strokeLinecap="round">
            <line x1={8} y1={8} x2={36} y2={36} />
            <line x1={36} y1={8} x2={8} y2={36} />
          </g>
        )}
        {status === 'implant' && (
          <circle cx={22} cy={22} r={5} fill="none" stroke="#0ea5e9" strokeWidth={2} />
        )}
      </svg>
      <span
        className="text-[10px] font-mono font-medium leading-none"
        style={{ color: status && status !== 'sound' ? statusColor : undefined }}
      >
        {fdi}
      </span>
    </div>
  );
}
