// =============================================================================
// Filial tarmog'i — kim nimani ko'radi/boshqaradi (sof funksiyalar, testlanadi).
// =============================================================================

export type MemberRole = 'company_owner' | 'company_admin' | 'branch_user';

export interface Membership {
  role: MemberRole;
  accessible_clinic_ids: string[];
}

export interface NetworkViewer {
  companyId: string;
  /** null — tarmoq a'zosi emas (bitta filialli klinika rahbari) */
  memberRole: MemberRole | null;
  /** Tarmoq markazida ko'rinadigan filiallar */
  branchIds: string[];
  /** Katalog tarqatish, filial sozlamalari, transferlarni boshqarish */
  canManage: boolean;
  /** A'zolar va tarmoq sozlamalari — faqat egasi */
  isOwner: boolean;
}

const CLINIC_LEADER_ROLES = new Set(['clinic_owner', 'clinic_admin']);

/**
 * Tarmoq markazi (CEO ko'rinishi) huquqi:
 *   company_owner / company_admin — barcha filiallar
 *   branch_user — ruxsat etilgan filiallar ([] = hammasi), faqat ko'rish
 *   a'zo emas — faqat bitta filialli klinikaning egasi/admini o'z klinikasini
 *   ko'radi (tarmoqqa ulangan filial admini butun tarmoqni KO'RMAYDI)
 */
export function resolveViewer(input: {
  companyId: string;
  activeClinicId: string;
  jwtRole: string;
  membership: Membership | null;
  liveBranchIds: string[];
}): NetworkViewer | null {
  const { companyId, activeClinicId, jwtRole, membership, liveBranchIds } = input;
  if (membership) {
    if (membership.role === 'company_owner' || membership.role === 'company_admin') {
      return {
        companyId,
        memberRole: membership.role,
        branchIds: liveBranchIds,
        canManage: true,
        isOwner: membership.role === 'company_owner',
      };
    }
    const allowed =
      membership.accessible_clinic_ids.length === 0
        ? liveBranchIds
        : liveBranchIds.filter((id) => membership.accessible_clinic_ids.includes(id));
    return {
      companyId,
      memberRole: 'branch_user',
      branchIds: allowed.length ? allowed : [activeClinicId],
      canManage: false,
      isOwner: false,
    };
  }
  if (liveBranchIds.length <= 1 && CLINIC_LEADER_ROLES.has(jwtRole)) {
    return {
      companyId,
      memberRole: null,
      branchIds: [activeClinicId],
      canManage: true,
      isOwner: jwtRole === 'clinic_owner' || jwtRole === 'clinic_admin',
    };
  }
  return null;
}

/** jsonb massivini (accessible_clinic_ids) xavfsiz string[] ga */
export function toIdList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

const fmt = (n: number) => Math.round(Number(n) || 0).toLocaleString('ru-RU');

export interface DigestRow {
  name: string;
  is_hq: boolean;
  received_uzs: number;
  pharmacy_uzs: number;
  debt_uzs: number;
  queue_total: number;
  new_patients: number;
  open_shifts: number;
  safe_uzs: number;
}

/** Tarmoq kunlik hisoboti (Telegram HTML) — eng ko'p tushumli filial yuqorida. */
export function formatNetworkDigest(companyName: string, day: string, rows: DigestRow[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const sorted = [...rows].sort(
    (a, b) => b.received_uzs + b.pharmacy_uzs - (a.received_uzs + a.pharmacy_uzs),
  );
  const total = sorted.reduce(
    (acc, r) => ({
      received: acc.received + r.received_uzs,
      pharmacy: acc.pharmacy + r.pharmacy_uzs,
      debt: acc.debt + r.debt_uzs,
      visits: acc.visits + r.queue_total,
      newPatients: acc.newPatients + r.new_patients,
    }),
    { received: 0, pharmacy: 0, debt: 0, visits: 0, newPatients: 0 },
  );
  const lines = sorted.map((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const open = r.open_shifts > 0 ? ` · ⚠️ ${r.open_shifts} smena ochiq` : '';
    return (
      `${medal} <b>${esc(r.name)}</b>${r.is_hq ? ' (HQ)' : ''}\n` +
      `   💰 ${fmt(r.received_uzs + r.pharmacy_uzs)} so'm` +
      (r.pharmacy_uzs > 0 ? ` (dorixona ${fmt(r.pharmacy_uzs)})` : '') +
      `\n   👥 ${r.queue_total} navbat · 🆕 ${r.new_patients} yangi bemor` +
      (r.debt_uzs > 0 ? ` · 📕 qarz ${fmt(r.debt_uzs)}` : '') +
      `\n   🔐 seyf ${fmt(r.safe_uzs)}${open}`
    );
  });
  return (
    `🏢 <b>${esc(companyName)}</b> — tarmoq hisoboti, ${day}\n\n` +
    `💰 Jami tushum: <b>${fmt(total.received + total.pharmacy)} so'm</b>\n` +
    `👥 Navbat: ${total.visits} · 🆕 Yangi bemor: ${total.newPatients}` +
    (total.debt > 0 ? `\n📕 Yangi qarz: ${fmt(total.debt)} so'm` : '') +
    `\n\n${lines.join('\n\n')}`
  );
}
