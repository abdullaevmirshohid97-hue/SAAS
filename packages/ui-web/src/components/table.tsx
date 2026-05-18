import * as React from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';

import { cn } from '../utils';
import { Skeleton } from './skeleton';
import { EmptyState } from './empty-state';

// =============================================================================
// Table — primitiv stillangan wrapper'lar (shadcn uslubi) + config-asosidagi
// DataTable. Korxona darajasidagi jadval: sort, sahifalash, qator bosish,
// loading skeleton, bo'sh holat.
// =============================================================================

export const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...p }, ref) => (
  <div className="w-full overflow-x-auto">
    <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...p} />
  </div>
));
Table.displayName = 'Table';

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...p }, ref) => (
  <thead
    ref={ref}
    className={cn(
      'border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground [&_tr]:border-b-0',
      className,
    )}
    {...p}
  />
));
TableHeader.displayName = 'TableHeader';

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...p }, ref) => (
  <tbody ref={ref} className={cn('divide-y', className)} {...p} />
));
TableBody.displayName = 'TableBody';

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...p }, ref) => (
  <tr ref={ref} className={cn('transition-colors hover:bg-muted/40', className)} {...p} />
));
TableRow.displayName = 'TableRow';

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...p }, ref) => (
  <th
    ref={ref}
    className={cn('px-3 py-2.5 text-left font-medium', className)}
    {...p}
  />
));
TableHead.displayName = 'TableHead';

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...p }, ref) => (
  <td ref={ref} className={cn('px-3 py-2.5 align-middle', className)} {...p} />
));
TableCell.displayName = 'TableCell';

export const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...p }, ref) => (
  <caption ref={ref} className={cn('mt-3 text-xs text-muted-foreground', className)} {...p} />
));
TableCaption.displayName = 'TableCaption';

// ── DataTable — config-asosidagi ─────────────────────────────────────────────

export interface DataTableColumn<T> {
  /** Ustun kaliti — sort uchun ham ishlatiladi. */
  key: string;
  /** Sarlavha matni. */
  header: string;
  /** Qator → katak mazmuni. Berilmasa — (row as any)[key]. */
  render?: (row: T) => React.ReactNode;
  /** Bu ustun bo'yicha sort qilish mumkinmi. */
  sortable?: boolean;
  /** Sort uchun qiymat (render'dan farqli — taqqoslanadigan). */
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** Har qatorning barqaror kaliti. */
  rowKey: (row: T) => string;
  isLoading?: boolean;
  onRowClick?: (row: T) => void;
  /** Bo'sh holat — berilmasa standart EmptyState. */
  emptyState?: React.ReactNode;
  /** Sahifa hajmi — berilsa sahifalash yoqiladi. */
  pageSize?: number;
  className?: string;
}

const alignClass: Record<NonNullable<DataTableColumn<unknown>['align']>, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading,
  onRowClick,
  emptyState,
  pageSize,
  className,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');
  const [page, setPage] = React.useState(0);

  const sorted = React.useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return rows;
    const val = (row: T): string | number => {
      if (col.sortValue) return col.sortValue(row);
      const raw = (row as Record<string, unknown>)[col.key];
      return typeof raw === 'number' ? raw : String(raw ?? '');
    };
    const out = [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return out;
  }, [rows, sortKey, sortDir, columns]);

  const paged = React.useMemo(() => {
    if (!pageSize) return sorted;
    return sorted.slice(page * pageSize, page * pageSize + pageSize);
  }, [sorted, pageSize, page]);

  const totalPages = pageSize ? Math.ceil(sorted.length / pageSize) : 1;

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  if (!isLoading && rows.length === 0) {
    return (
      <>
        {emptyState ?? (
          <EmptyState title="Ma'lumot yo'q" description="Hozircha yozuv mavjud emas" />
        )}
      </>
    );
  }

  return (
    <div className={cn('rounded-lg border', className)}>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.key} className={c.align ? alignClass[c.align] : undefined}>
                {c.sortable ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(c.key)}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    {c.header}
                    {sortKey === c.key ? (
                      sortDir === 'asc' ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )
                    ) : (
                      <ChevronsUpDown className="h-3 w-3 opacity-40" />
                    )}
                  </button>
                ) : (
                  c.header
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading
            ? Array.from({ length: pageSize ?? 6 }).map((_, i) => (
                <TableRow key={`sk-${i}`}>
                  {columns.map((c) => (
                    <TableCell key={c.key}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : paged.map((row) => (
                <TableRow
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={onRowClick ? 'cursor-pointer' : undefined}
                >
                  {columns.map((c) => (
                    <TableCell
                      key={c.key}
                      className={cn(c.align ? alignClass[c.align] : undefined, c.className)}
                    >
                      {c.render
                        ? c.render(row)
                        : String((row as Record<string, unknown>)[c.key] ?? '')}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>

      {pageSize && totalPages > 1 && (
        <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
          <span>
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sorted.length)} /{' '}
            {sorted.length}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded border px-2 py-1 disabled:opacity-40 hover:bg-muted/60"
            >
              Oldingi
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded border px-2 py-1 disabled:opacity-40 hover:bg-muted/60"
            >
              Keyingi
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
