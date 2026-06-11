import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { tap } from 'rxjs';

import { getContextSafe } from '../context/request-context';
import { SupabaseService } from '../services/supabase.service';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
// Payload'dagi sezgir maydonlar logga tushmasin.
const SENSITIVE_KEYS = /password|pin|secret|token/i;
const BODY_EXCERPT_MAX = 500;

/**
 * Super-admin mutatsion amallarini admin_actions jadvaliga yozadi —
 * "kim qachon nimani o'zgartirdi" auditi. Faqat muvaffaqiyatli
 * POST/PATCH/PUT/DELETE /api/v1/admin/* so'rovlari loglanadi.
 */
@Injectable()
export class AdminActionsInterceptor implements NestInterceptor {
  private readonly log = new Logger('AdminActions');

  constructor(private readonly supabase: SupabaseService) {}

  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest<{
      method: string;
      originalUrl?: string;
      url: string;
      body?: unknown;
      ip?: string;
    }>();
    const path = req.originalUrl ?? req.url ?? '';
    const isAdminMutation =
      MUTATING.has(req.method) && /\/v1\/admin(\/|$)/.test(path);

    if (!isAdminMutation) return next.handle();

    return next.handle().pipe(
      tap(() => {
        const c = getContextSafe();
        void this.supabase
          .admin()
          .from('admin_actions')
          .insert({
            admin_id: c?.userId ?? null,
            method: req.method,
            path: path.slice(0, 300),
            body_excerpt: this.excerpt(req.body),
            ip: req.ip ?? null,
          })
          .then(({ error }) => {
            if (error) this.log.warn(`admin_actions yozilmadi: ${error.message}`);
          });
      }),
    );
  }

  private excerpt(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const masked: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      masked[k] = SENSITIVE_KEYS.test(k) ? '***' : v;
    }
    try {
      return JSON.stringify(masked).slice(0, BODY_EXCERPT_MAX);
    } catch {
      return null;
    }
  }
}
