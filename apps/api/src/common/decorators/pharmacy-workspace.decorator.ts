import { SetMetadata } from '@nestjs/common';

// =============================================================================
// Alohida "Dorixona" kirishi — endpoint darajasidagi qoidalar
// =============================================================================
// Bu dekoratorlar FAQAT dorixona akkauntiga (JWT workspace='pharmacy') ta'sir
// qiladi. Klinika foydalanuvchilari uchun odatdagi @Roles / @RequirePerm
// tekshiruvlari o'zgarishsiz ishlaydi.

export const PHARMACY_ADMIN_KEY = 'pharmacy_admin';
export const PHARMACY_CAP_KEY = 'pharmacy_cap';
export const PHARMACY_WS_OPEN_KEY = 'pharmacy_ws_open';

export type PharmacyCap = 'return' | 'receive' | 'discount';

/**
 * Dorixona kirishida faqat ADMIN PIN bilan ochilgan sessiya bajara oladi
 * (narx, prixod bekor qilish, sozlamalar, PIN/qurilmalar...).
 * Klinika foydalanuvchisi uchun endpointdagi @Roles amal qilaveradi.
 */
export const PharmacyAdmin = () => SetMetadata(PHARMACY_ADMIN_KEY, true);

/** Kassir uchun admin bergan ruxsat kerak (qaytarish, prixod, chegirma). Admin — doim. */
export const PharmacyCapability = (cap: PharmacyCap) => SetMetadata(PHARMACY_CAP_KEY, cap);

/**
 * Kirish bosqichidagi endpointlar:
 *  'no-device'   — qurilma ham, PIN ham talab qilinmaydi (holat, qurilmani ro'yxatga olish)
 *  'no-operator' — qurilma kerak, PIN hali yo'q (PIN kiritish, birinchi admin)
 */
export const PharmacyWsOpen = (level: 'no-device' | 'no-operator') =>
  SetMetadata(PHARMACY_WS_OPEN_KEY, level);
