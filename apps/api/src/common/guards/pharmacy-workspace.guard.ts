import { createHash } from 'node:crypto';

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { getContext, isPharmacyAccount } from '../context/request-context';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  PHARMACY_ADMIN_KEY,
  PHARMACY_CAP_KEY,
  PHARMACY_WS_OPEN_KEY,
  type PharmacyCap,
} from '../decorators/pharmacy-workspace.decorator';
import { SupabaseService } from '../services/supabase.service';

// =============================================================================
// Alohida "Dorixona" kirishi — dorixona akkaunti uchun himoya qatlami
// =============================================================================
// Dorixona akkaunti (bitta Gmail, 3 tagacha kompyuter) klinikaga 'pharmacist'
// roli bilan ulangan. Bu guard unga:
//   1) FAQAT dorixona API'larini ochadi — klinika ma'lumotlari (bemorlar,
//      qabulxona, jurnal...) yopiq, kassir boshqa bo'limni API orqali ham ocholmaydi;
//   2) har so'rovda ro'yxatdan o'tgan va bekor qilinmagan QURILMA talab qiladi;
//   3) PIN bilan ochilgan OPERATOR sessiyasini talab qiladi (Admin / Kassa 1 / 2);
//   4) @PharmacyAdmin / @PharmacyCapability qoidalarini tekshiradi.
// Klinika foydalanuvchilariga (workspace != 'pharmacy') umuman ta'sir qilmaydi.
// =============================================================================

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

const ALLOWED_PREFIXES = [
  '/api/v1/pharmacy', // /pharmacy/* va /pharmacy-ws/*
  '/api/v1/auth/me',
  '/api/v1/thermal-printers',
  '/api/v1/status',
  '/api/v1/health',
];

function pathAllowed(path: string): boolean {
  return ALLOWED_PREFIXES.some(
    (p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '-'),
  );
}

type DeviceRow = {
  id: string;
  name: string;
  register_no: number | null;
  is_revoked: boolean;
};

type SessionRow = {
  id: string;
  device_id: string | null;
  expires_at: string;
  revoked_at: string | null;
  operator: {
    id: string;
    full_name: string;
    role: 'admin' | 'cashier';
    register_no: number | null;
    can_return: boolean;
    can_receive: boolean;
    can_discount: boolean;
    is_active: boolean;
  } | null;
};

@Injectable()
export class PharmacyWorkspaceGuard implements CanActivate {
  private readonly log = new Logger('PharmacyWorkspace');
  private readonly deviceCache = new Map<string, { at: number; v: DeviceRow | null }>();
  private readonly sessionCache = new Map<string, { at: number; v: SessionRow | null }>();
  private readonly touched = new Map<string, number>();
  private readonly TTL = 15_000;

  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const c = getContext();
    if (!isPharmacyAccount(c)) return true;
    if (!c.clinicId) throw new ForbiddenException('No clinic context on token');

    const req = ctx.switchToHttp().getRequest<{ originalUrl?: string; url?: string }>();
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
    if (!pathAllowed(path)) {
      throw new ForbiddenException({
        error: 'PHARMACY_SCOPE',
        message: "Dorixona akkaunti bu bo'limga kira olmaydi",
      });
    }

    const open = this.reflector.getAllAndOverride<'no-device' | 'no-operator' | undefined>(
      PHARMACY_WS_OPEN_KEY,
      targets,
    );
    const isInfra =
      path.startsWith('/api/v1/auth/') ||
      path.startsWith('/api/v1/status') ||
      path.startsWith('/api/v1/health');
    if (isInfra || open === 'no-device') return true;

    const device = await this.resolveDevice(c.clinicId, c.pharmacyDeviceKey ?? null);
    if (!device) {
      throw new ForbiddenException({
        error: 'DEVICE_NOT_REGISTERED',
        message: "Bu kompyuter dorixona uchun ro'yxatdan o'tmagan",
      });
    }
    if (device.is_revoked) {
      throw new ForbiddenException({
        error: 'DEVICE_REVOKED',
        message: "Bu kompyuter dorixona admini tomonidan o'chirilgan",
      });
    }
    c.pharmacy = {
      deviceId: device.id,
      deviceName: device.name,
      registerNo: device.register_no,
      operatorId: null,
      operatorName: null,
      operatorRole: null,
      canReturn: false,
      canReceive: false,
      canDiscount: false,
    };
    this.touch('d:' + device.id, () =>
      this.supabase
        .admin()
        .from('pharmacy_devices')
        .update({ last_seen_at: new Date().toISOString(), last_ip: c.ip })
        .eq('id', device.id),
    );

    if (open === 'no-operator') return true;

    const session = await this.resolveSession(
      c.clinicId,
      c.pharmacyOperatorToken ?? null,
      device.id,
    );
    if (!session || !session.operator) {
      throw new ForbiddenException({
        error: 'OPERATOR_PIN_REQUIRED',
        message: 'PIN kodni kiriting',
      });
    }
    const op = session.operator;
    c.pharmacy = {
      ...c.pharmacy,
      operatorId: op.id,
      operatorName: op.full_name,
      operatorRole: op.role,
      registerNo: op.register_no ?? device.register_no,
      canReturn: op.role === 'admin' || op.can_return,
      canReceive: op.role === 'admin' || op.can_receive,
      canDiscount: op.role === 'admin' || op.can_discount,
    };
    this.touch('s:' + session.id, () =>
      this.supabase
        .admin()
        .from('pharmacy_operator_sessions')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', session.id),
    );

    if (
      this.reflector.getAllAndOverride<boolean>(PHARMACY_ADMIN_KEY, targets) &&
      op.role !== 'admin'
    ) {
      throw new ForbiddenException({
        error: 'PHARMACY_ADMIN_ONLY',
        message: 'Bu amal faqat admin PIN bilan bajariladi',
      });
    }
    const cap = this.reflector.getAllAndOverride<PharmacyCap | undefined>(
      PHARMACY_CAP_KEY,
      targets,
    );
    if (cap) {
      const ok =
        cap === 'return'
          ? c.pharmacy.canReturn
          : cap === 'receive'
            ? c.pharmacy.canReceive
            : c.pharmacy.canDiscount;
      if (!ok) {
        throw new ForbiddenException({
          error: 'PHARMACY_CAP_DENIED',
          message: "Bu amalga ruxsat yo'q — admin sozlamalarda ruxsat berishi kerak",
        });
      }
    }
    return true;
  }

  private async resolveDevice(clinicId: string, key: string | null): Promise<DeviceRow | null> {
    if (!key || key.length < 16) return null;
    const hash = sha256Hex(key);
    const cacheKey = `${clinicId}:${hash}`;
    const hit = this.deviceCache.get(cacheKey);
    if (hit && Date.now() - hit.at < this.TTL) return hit.v;
    const { data } = await this.supabase
      .admin()
      .from('pharmacy_devices')
      .select('id, name, register_no, is_revoked')
      .eq('clinic_id', clinicId)
      .eq('device_key_hash', hash)
      .maybeSingle();
    const v = (data as DeviceRow | null) ?? null;
    this.deviceCache.set(cacheKey, { at: Date.now(), v });
    return v;
  }

  private async resolveSession(
    clinicId: string,
    token: string | null,
    deviceId: string,
  ): Promise<SessionRow | null> {
    if (!token || token.length < 20) return null;
    const hash = sha256Hex(token);
    const hit = this.sessionCache.get(hash);
    let v: SessionRow | null;
    if (hit && Date.now() - hit.at < this.TTL) {
      v = hit.v;
    } else {
      const { data } = await this.supabase
        .admin()
        .from('pharmacy_operator_sessions')
        .select(
          'id, device_id, expires_at, revoked_at, ' +
            'operator:pharmacy_operators(id, full_name, role, register_no, can_return, can_receive, can_discount, is_active)',
        )
        .eq('clinic_id', clinicId)
        .eq('token_hash', hash)
        .maybeSingle();
      const row = data as unknown as
        | (Omit<SessionRow, 'operator'> & {
            operator: SessionRow['operator'] | SessionRow['operator'][];
          })
        | null;
      v = row
        ? {
            ...row,
            operator: Array.isArray(row.operator) ? (row.operator[0] ?? null) : row.operator,
          }
        : null;
      this.sessionCache.set(hash, { at: Date.now(), v });
    }
    if (!v) return null;
    if (v.revoked_at) return null;
    if (new Date(v.expires_at).getTime() < Date.now()) return null;
    if (!v.operator || !v.operator.is_active) return null;
    // Sessiya qaysi kompyuterda ochilgan bo'lsa faqat o'sha kompyuterda ishlaydi
    if (v.device_id && v.device_id !== deviceId) return null;
    return v;
  }

  /** last_seen ustunini tez-tez yozmaslik uchun (5 daqiqada bir marta). */
  private touch(key: string, run: () => PromiseLike<unknown>): void {
    const last = this.touched.get(key) ?? 0;
    if (Date.now() - last < 5 * 60_000) return;
    this.touched.set(key, Date.now());
    try {
      void Promise.resolve(run()).then(undefined, (e: Error) =>
        this.log.warn(`last_seen yozilmadi: ${e?.message}`),
      );
    } catch {
      /* kuzatuv hech qachon so'rovni buzmaydi */
    }
  }
}
