import { z } from 'zod';

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().optional(),
  includeArchived: z.coerce.boolean().default(false),
  sort: z.string().optional(), // "field:asc,field2:desc"
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function parseSort(sort: string | undefined, allowed: readonly string[]): Array<{ field: string; dir: 'asc' | 'desc' }> {
  if (!sort) return [];
  return sort
    .split(',')
    .map((s) => {
      const [field, dir] = s.split(':');
      if (!field || !allowed.includes(field)) return null;
      return { field, dir: (dir === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc' };
    })
    .filter((s): s is { field: string; dir: 'asc' | 'desc' } => s !== null);
}
