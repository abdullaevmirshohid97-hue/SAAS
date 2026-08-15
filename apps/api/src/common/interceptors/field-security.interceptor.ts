import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { from, switchMap } from 'rxjs';

import { getContextSafe } from '../context/request-context';
import { hiddenFieldsFor } from '../rbac/permissions';
import { PermissionsResolver } from '../services/permissions-resolver.service';

// =============================================================================
// Maydon darajasidagi xavfsizlik — YAGONA filtrlash nuqtasi
// =============================================================================
// Javob obyektlaridan foydalanuvchiga ruxsat etilmagan maydonlar olib
// tashlanadi. Har endpointda takrorlanmaydi — bir joyda, bir marta.
//
// TAMOYILLAR
// 1) QORA RO'YXAT: faqat PROTECTED_FIELDS dagi nomlar olib tashlanadi.
//    Boshqa hamma narsa tegilmaydi — xato bo'lganda ma'lumot jimgina
//    yo'qolmaydi (bugun shu sinfdagi uchta xato topilgan).
// 2) MAYDON O'CHIRILMAYDI, `null` qilinadi va yoniga `<field>_hidden: true`
//    qo'yiladi. Shunda UI "ma'lumot yo'q" bilan "ko'rishga ruxsat yo'q" ni
//    ajrata oladi va `•••` ko'rsatadi — xodim maydon borligini biladi.
// 3) Owner/admin/super_admin uchun umuman ishlamaydi (tezkor yo'l).
//
// CHEKLOV: filtr maydon NOMI bo'yicha ishlaydi, shuning uchun reyestrda
// faqat o'ziga xos nomlar bor (`pinfl`, `diagnosis_code`...). `phone` kabi
// umumiy nomlar ataylab kiritilmagan.

const FULL_ACCESS_ROLES = new Set(['super_admin', 'clinic_owner', 'clinic_admin']);
const MAX_DEPTH = 6;

@Injectable()
export class FieldSecurityInterceptor implements NestInterceptor {
  private readonly log = new Logger('FieldSecurity');

  constructor(private readonly perms: PermissionsResolver) {}

  intercept(ctx: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      switchMap((result) => {
        const c = getContextSafe();
        if (!c?.userId || !c?.role) return from(Promise.resolve(result));
        if (FULL_ACCESS_ROLES.has(c.role)) return from(Promise.resolve(result));
        const role = c.role;
        const userId = c.userId;

        // ATAYLAB `resolve()` (keshlangan, TTL 60s), `cached()` EMAS.
        // cached() bo'sh bo'lsa maydon BA'ZAN yashirinib qolardi — bunday
        // tasodifiy xatti-harakatni tashxislash juda qiyin.
        return from(
          this.perms
            .resolve(userId)
            .catch((e: Error) => {
              // Baza uzilsa so'rovni yiqitmaymiz: rol standartlariga
              // qaytamiz (himoyalangan maydon yopiq qoladi — xavfsiz tomon).
              this.log.warn(`ruxsatlar olinmadi, rol standarti: ${e.message}`);
              return null;
            })
            .then((perms) => {
              const hidden = hiddenFieldsFor(role, perms);
              return hidden.length === 0 ? result : redact(result, new Set(hidden), 0);
            }),
        );
      }),
    );
  }
}

/** Rekursiv tozalash — massiv va ichma-ich obyektlar bo'yicha. Test uchun eksport. */
export function redact(value: unknown, hidden: Set<string>, depth: number): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, hidden, depth + 1));
  }

  // Date, Buffer va shunga o'xshash obyektlarga tegmaymiz.
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (hidden.has(k)) {
      out[k] = null;
      out[`${k}_hidden`] = true;
      continue;
    }
    out[k] = redact(v, hidden, depth + 1);
  }
  return out;
}
