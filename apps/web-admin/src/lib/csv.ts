// CSV eksport yordamchisi — jadval ma'lumotlarini brauzerda .csv qilib yuklab
// beradi. Excel (Windows) uchun UTF-8 BOM qo'shiladi.
export function downloadCsv(
  filename: string,
  rows: Array<Record<string, unknown>>,
  columns: Array<{ key: string; label: string }>,
): void {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = columns.map((c) => esc(c.label)).join(',');
  const lines = rows.map((r) => columns.map((c) => esc(r[c.key])).join(','));
  const csv = '﻿' + [header, ...lines].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
