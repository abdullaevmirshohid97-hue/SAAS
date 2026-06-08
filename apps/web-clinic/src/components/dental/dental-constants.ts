// Stomatologiya — FDI joylashuvi, tish holatlari va yuza (surface) shartlari.
// dental_teeth.status CHECK bilan mos (20260424001040 + 20260609000001).

// ---- FDI joylashuvi (kattalar) ----
// Ekranda: yuqori qator (kesma), pastki qator. Bemorning O'NG tomoni (kvadrant
// 1 va 4) ko'ruvchining CHAP tomonida turadi.
export const FDI_ADULT = {
  upperRight: [18, 17, 16, 15, 14, 13, 12, 11],
  upperLeft: [21, 22, 23, 24, 25, 26, 27, 28],
  lowerRight: [48, 47, 46, 45, 44, 43, 42, 41],
  lowerLeft: [31, 32, 33, 34, 35, 36, 37, 38],
} as const;

// ---- FDI joylashuvi (sut tishlari, bolalar) ----
export const FDI_CHILD = {
  upperRight: [55, 54, 53, 52, 51],
  upperLeft: [61, 62, 63, 64, 65],
  lowerRight: [85, 84, 83, 82, 81],
  lowerLeft: [71, 72, 73, 74, 75],
} as const;

// ---- Yuza (surface) kalitlari + shartlari ----
export type SurfaceKey = 'mesial' | 'distal' | 'buccal' | 'lingual' | 'occlusal';
export const SURFACE_KEYS: SurfaceKey[] = ['mesial', 'distal', 'buccal', 'lingual', 'occlusal'];
export const SURFACE_LABEL: Record<SurfaceKey, string> = {
  mesial: 'Mesial',
  distal: 'Distal',
  buccal: 'Vestibulyar (yonoq)',
  lingual: 'Lingual (til/tanglay)',
  occlusal: 'Okklyuzion (markaz)',
};

export const SURFACE_CONDITIONS: Array<{ v: string; label: string; color: string }> = [
  { v: '', label: 'Yo‘q (sog‘lom)', color: '#ffffff' },
  { v: 'caries', label: 'Karies', color: '#ef4444' },
  { v: 'filling', label: 'Plomba', color: '#3b82f6' },
  { v: 'sealant', label: 'Germetik (fissura)', color: '#14b8a6' },
];
export const SURFACE_COLOR: Record<string, string> = Object.fromEntries(
  SURFACE_CONDITIONS.map((c) => [c.v, c.color]),
);

// ---- Butun-tish holatlari ----
export const TOOTH_STATUS_META: Array<{ v: string; label: string; color: string }> = [
  { v: 'sound', label: 'Sog‘lom', color: '#e5e7eb' },
  { v: 'pulpitis', label: 'Pulpit', color: '#e11d48' },
  { v: 'periodontitis', label: 'Periodontit', color: '#be123c' },
  { v: 'root_canal', label: 'Kanal davolash', color: '#a855f7' },
  { v: 'crown', label: 'Koronka', color: '#f59e0b' },
  { v: 'bridge', label: 'Ko‘prik', color: '#d97706' },
  { v: 'implant', label: 'Implant', color: '#0ea5e9' },
  { v: 'extracted', label: 'Olib tashlangan', color: '#6b7280' },
  { v: 'missing', label: 'Yo‘q (tushgan)', color: '#9ca3af' },
  { v: 'mobile', label: 'Qimirlayotgan', color: '#fb923c' },
  { v: 'fractured', label: 'Singan', color: '#dc2626' },
  { v: 'impacted', label: 'Retinatsiya', color: '#65a30d' },
  { v: 'erupting', label: 'Chiqayotgan', color: '#84cc16' },
  { v: 'discolored', label: 'Rangi o‘zgargan', color: '#a16207' },
  { v: 'sensitive', label: 'Sezgir', color: '#eab308' },
  { v: 'watch', label: 'Kuzatuv', color: '#f59e0b' },
];
export const TOOTH_STATUS_COLOR: Record<string, string> = Object.fromEntries(
  TOOTH_STATUS_META.map((s) => [s.v, s.color]),
);
export const TOOTH_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  TOOTH_STATUS_META.map((s) => [s.v, s.label]),
);

// Tishni butunlay "yo'q" deb ko'rsatadigan holatlar (X chiziladi).
export const ABSENT_STATUSES = new Set(['missing', 'extracted']);

// ---- Ekran zonasi → anatomik yuza moslamasi (kvadrantga qarab) ----
// top/right/bottom/left + center. Mesial doimo yoy markaziga qaraydi.
export function surfaceMapForTooth(fdi: number): Record<'top' | 'right' | 'bottom' | 'left' | 'center', SurfaceKey> {
  const quadrant = Math.floor(fdi / 10); // 1..4 (yoki 5..8 sut)
  const isUpper = quadrant === 1 || quadrant === 2 || quadrant === 5 || quadrant === 6;
  const isRightSide = quadrant === 1 || quadrant === 4 || quadrant === 5 || quadrant === 8;
  return {
    top: isUpper ? 'buccal' : 'lingual',
    bottom: isUpper ? 'lingual' : 'buccal',
    left: isRightSide ? 'distal' : 'mesial',
    right: isRightSide ? 'mesial' : 'distal',
    center: 'occlusal',
  };
}
