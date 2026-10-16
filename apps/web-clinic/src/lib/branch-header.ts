// =============================================================================
// Filial tarmog'i — sahifadagi FAOL filial.
// Sahifa ochilgandagi filial (JWT clinic_id) eslab qolinadi va har API
// so'rovga X-Clary-Branch sarlavhasi bilan yuboriladi. Boshqa oynada filial
// almashtirilsa token yangilanadi, lekin bu sahifa eski filial ma'lumotini
// ko'rsatib turadi — server 409 BRANCH_MISMATCH qaytaradi va sahifa
// yangilanadi (pul noto'g'ri filialga yozilmasin).
// =============================================================================

let uiUser: string | null = null;
let uiBranch: string | null = null;
let reloading = false;

export function branchHeaders(): Record<string, string> {
  return uiBranch ? { 'X-Clary-Branch': uiBranch } : {};
}

/**
 * Sessiya o'zgarganda chaqiriladi. 'changed' — o'sha foydalanuvchining faol
 * filiali boshqa joyda almashtirilgan (sahifani yangilash kerak).
 */
export function syncUiBranch(userId: string | null, clinicId: string | null): 'ok' | 'changed' {
  if (!userId) {
    uiUser = null;
    uiBranch = null;
    return 'ok';
  }
  if (uiUser !== userId) {
    uiUser = userId;
    uiBranch = clinicId;
    return 'ok';
  }
  if (!uiBranch) {
    uiBranch = clinicId;
    return 'ok';
  }
  return clinicId && clinicId !== uiBranch ? 'changed' : 'ok';
}

/**
 * Shu oynaning o'zi filial almashtirmoqda: server javobidan keyin chaqiriladi —
 * oyna o'zini "eskirgan" deb hisoblamasin, oraliqdagi 409 lar e'tiborsiz
 * (keyin baribir yangi filial bilan to'liq yuklanadi).
 */
export function expectBranch(clinicId: string): void {
  uiBranch = clinicId;
  reloading = true;
}

export function reloadForBranchChange(): void {
  if (reloading) return;
  reloading = true;
  // Ma'lumot keshi (react-query), Realtime kanallar, softfon — hammasi yangi
  // filial bilan toza boshlanishi uchun to'liq qayta yuklash
  window.setTimeout(() => window.location.reload(), 400);
}
