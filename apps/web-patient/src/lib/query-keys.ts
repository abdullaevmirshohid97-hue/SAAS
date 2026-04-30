export const QK = {
  clinics: (p?: object) => ['clinics', p] as const,
  clinic: (slug: string) => ['clinic', slug] as const,
  clinicSlots: (slug: string, p?: object) => ['clinic-slots', slug, p] as const,
  bookings: () => ['bookings'] as const,
  nurseTariffs: (p?: object) => ['nurse-tariffs', p] as const,
  nurseRequests: () => ['nurse-requests'] as const,
  queueStatus: (id: string) => ['queue', id] as const,
  profile: () => ['profile'] as const,
} as const;
