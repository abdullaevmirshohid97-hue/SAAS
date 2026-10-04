import { SetMetadata } from '@nestjs/common';

import type { PermissionKey } from '../rbac/permissions';

export const REQUIRE_PERM_KEY = 'require_perm';
export const REQUIRE_ANY_PERM_KEY = 'require_any_perm';

/** Ro'yxatdagi HAMMA ruxsat kerak. */
export const RequirePerm = (...keys: PermissionKey[]) => SetMetadata(REQUIRE_PERM_KEY, keys);

/**
 * Ro'yxatdan KAMIDA BITTA ruxsat yetarli. Masalan dori qidiruvi dorixonachi
 * (pharmacy.view) uchun ham, qabulxona "Dori bilan" (cashier.accept_payment)
 * uchun ham ochiq bo'lishi kerak.
 */
export const RequireAnyPerm = (...keys: PermissionKey[]) => SetMetadata(REQUIRE_ANY_PERM_KEY, keys);
