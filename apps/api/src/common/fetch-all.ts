import { BadRequestException } from '@nestjs/common';

/**
 * PostgREST (Supabase) bitta so'rovda ko'pi bilan 1000 qator qaytaradi va
 * qolganini JIMGINA kesadi — oylik/yillik yig'indilar noto'g'ri chiqardi.
 * Bu yordamchi `.range()` bilan barcha sahifalarni yig'adi.
 * So'rov barqaror tartibda bo'lishi kerak (`.order(...)`), aks holda sahifalar
 * orasida qatorlar takrorlanishi/tushib qolishi mumkin.
 */
export async function fetchAllRows<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  pageSize = 1000,
  maxRows = 100_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
