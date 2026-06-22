// =============================================================================
// Self-serve BI semantik registr (Faza 5B)
// Report Builder uchun ruxsat etilgan o'lcham/grain/metrika OQ-RO'YXATI.
// Bu yagona haqiqat manbai — API zod validatsiyasi shu yerdan; analytics_query
// RPC ham aynan shu qiymatlarni kutadi (sinxron saqlang).
// =============================================================================

export const QUERY_DIMENSIONS = [
  'time',
  'payment_method',
  'register',
  'source',
  'cashier',
] as const;
export type QueryDimension = (typeof QUERY_DIMENSIONS)[number];

export const QUERY_GRAINS = ['day', 'week', 'month'] as const;
export type QueryGrain = (typeof QUERY_GRAINS)[number];

// RPC qaytaradigan metrikalar (har satrda barchasi hisoblanadi).
export const QUERY_METRICS = ['revenue_uzs', 'tx_count', 'avg_check_uzs'] as const;
export type QueryMetric = (typeof QUERY_METRICS)[number];
