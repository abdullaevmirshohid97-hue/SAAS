import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

// Faol smena bormi — hook (tugmalarni disable qilish uchun).
export function useActiveShift() {
  const { data: shift } = useQuery({
    queryKey: ['shift-active'],
    queryFn: () => api.shifts.active(),
    refetchInterval: 30_000,
  });
  return { hasShift: !!shift, shift };
}
