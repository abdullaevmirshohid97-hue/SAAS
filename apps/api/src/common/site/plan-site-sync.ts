import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * plans jadvalidagi o'zgarishni landing CMS'dagi site_entries `plan.<code>`
 * yozuviga ko'chiradi (narx, nom). Pricing sahifasi shu yozuvdan o'qiydi —
 * yangilanmasa saytda eski narx qoladi. Yozuv bo'lmasa hech narsa qilmaydi.
 * To'g'ridan-to'g'ri published holatga yoziladi (narx — texnik fakt).
 */
export async function syncPlanToSiteEntry(
  admin: SupabaseClient,
  code: string,
  plan: Record<string, unknown>,
): Promise<void> {
  const { data: entry } = await admin
    .from('site_entries')
    .select('id, content_i18n, data')
    .eq('key', `plan.${code}`)
    .maybeSingle();
  if (!entry) return;

  const row = entry as {
    id: string;
    content_i18n: Record<string, Record<string, unknown>>;
    data: Record<string, unknown>;
  };
  const nextData = { ...row.data };
  if (typeof plan.price_usd_cents === 'number')
    nextData.price_usd = Math.round(plan.price_usd_cents / 100);
  if (typeof plan.price_uzs === 'number') nextData.price_uzs = plan.price_uzs;
  if (typeof plan.price_yearly_uzs === 'number') nextData.price_yearly_uzs = plan.price_yearly_uzs;

  const nextContent = { ...row.content_i18n };
  if (typeof plan.name === 'string' && plan.name) {
    for (const loc of Object.keys(nextContent)) {
      nextContent[loc] = { ...nextContent[loc], name: plan.name };
    }
  }

  await admin
    .from('site_entries')
    .update({ content_i18n: nextContent, data: nextData })
    .eq('id', row.id);
}
