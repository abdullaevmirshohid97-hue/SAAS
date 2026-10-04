import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { z } from 'zod';

import { getContextSafe, isPharmacyAccount } from '../../common/context/request-context';
import { sha256Hex } from '../../common/guards/pharmacy-workspace.guard';
import { SupabaseService } from '../../common/services/supabase.service';
import {
  DeviceRegisterSchema,
  DeviceUpdateSchema,
  OperatorCreateSchema,
  OperatorLoginSchema,
  OperatorSetupSchema,
  OperatorUpdateSchema,
} from './pharmacy.schemas';

// =============================================================================
// Alohida "Dorixona" kirishi: obuna holati, qurilmalar, PIN operatorlar
// =============================================================================
// Oqim (har kompyuterda): Gmail bilan kirish → obuna tekshiriladi → kompyuter
// ro'yxatga olinadi (obunadagi limit, standart 3) → PIN (Admin / Kassa 1 / Kassa 2).
// PIN'larni admin (yoki klinika egasi) Sozlamalar → "PIN va qurilmalar" da qo'yadi.
// =============================================================================

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 5;
const SESSION_HOURS = 14;

type OperatorRow = {
  id: string;
  full_name: string;
  role: 'admin' | 'cashier';
  register_no: number | null;
  pin_hash: string;
  pin_failed_attempts: number;
  pin_locked_until: string | null;
  can_return: boolean;
  can_receive: boolean;
  can_discount: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

const OP_PUBLIC =
  'id, full_name, role, register_no, can_return, can_receive, can_discount, is_active, sort_order, pin_locked_until, created_at';

@Injectable()
export class PharmacyWorkspaceService {
  constructor(private readonly supabase: SupabaseService) {}

  // ---------------------------------------------------------------- obuna ----
  async subscription(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('product_subscriptions')
      .select('status, ends_at, max_devices, price_uzs, account_email, starts_at')
      .eq('clinic_id', clinicId)
      .eq('product', 'pharmacy')
      .maybeSingle();
    const s = data as {
      status: string;
      ends_at: string;
      max_devices: number;
      price_uzs: number;
      account_email: string | null;
      starts_at: string;
    } | null;
    if (!s) {
      return {
        exists: false,
        active: false,
        status: null,
        ends_at: null,
        days_left: 0,
        max_devices: 0,
      };
    }
    const msLeft = new Date(s.ends_at).getTime() - Date.now();
    return {
      exists: true,
      active: s.status === 'active' && msLeft > 0,
      status: s.status,
      ends_at: s.ends_at,
      starts_at: s.starts_at,
      days_left: Math.max(0, Math.ceil(msLeft / 86_400_000)),
      max_devices: s.max_devices,
      price_uzs: Number(s.price_uzs),
      account_email: s.account_email,
    };
  }

  // --------------------------------------------------------------- holat -----
  async status(clinicId: string) {
    const c = getContextSafe();
    const admin = this.supabase.admin();
    const [sub, { data: clinic }] = await Promise.all([
      this.subscription(clinicId),
      admin.from('clinics').select('id, name, logo_url').eq('id', clinicId).maybeSingle(),
    ]);
    if (!isPharmacyAccount(c)) {
      return { is_pharmacy_account: false, subscription: sub, clinic };
    }

    const [{ data: devices }, { data: operators }] = await Promise.all([
      admin
        .from('pharmacy_devices')
        .select('id, name, register_no, is_revoked, device_key_hash, last_seen_at')
        .eq('clinic_id', clinicId),
      admin.from('pharmacy_operators').select('id, role, is_active').eq('clinic_id', clinicId),
    ]);
    const devs = (devices ?? []) as Array<{
      id: string;
      name: string;
      register_no: number | null;
      is_revoked: boolean;
      device_key_hash: string;
    }>;
    const hash = c?.pharmacyDeviceKey ? sha256Hex(c.pharmacyDeviceKey) : null;
    const mine = hash ? (devs.find((d) => d.device_key_hash === hash) ?? null) : null;
    const ops = ((operators ?? []) as Array<{ role: string; is_active: boolean }>).filter(
      (o) => o.is_active,
    );

    type OpInfo = {
      id: string;
      full_name: string;
      role: string;
      register_no: number | null;
      can_return: boolean;
      can_receive: boolean;
      can_discount: boolean;
    };
    let operator: OpInfo | null = null;
    if (mine && !mine.is_revoked && c?.pharmacyOperatorToken) {
      const { data: sess } = await admin
        .from('pharmacy_operator_sessions')
        .select(
          'device_id, expires_at, revoked_at, operator:pharmacy_operators(id, full_name, role, register_no, can_return, can_receive, can_discount, is_active)',
        )
        .eq('clinic_id', clinicId)
        .eq('token_hash', sha256Hex(c.pharmacyOperatorToken))
        .maybeSingle();
      const sr = sess as unknown as {
        device_id: string | null;
        expires_at: string;
        revoked_at: string | null;
        operator: (OpInfo & { is_active: boolean }) | Array<OpInfo & { is_active: boolean }> | null;
      } | null;
      const op = sr ? (Array.isArray(sr.operator) ? sr.operator[0] : sr.operator) : null;
      if (
        sr &&
        op &&
        op.is_active &&
        !sr.revoked_at &&
        new Date(sr.expires_at).getTime() > Date.now() &&
        (!sr.device_id || sr.device_id === mine.id)
      ) {
        operator = {
          id: op.id,
          full_name: op.full_name,
          role: op.role,
          register_no: op.register_no ?? mine.register_no,
          can_return: op.role === 'admin' || op.can_return,
          can_receive: op.role === 'admin' || op.can_receive,
          can_discount: op.role === 'admin' || op.can_discount,
        };
      }
    }

    return {
      is_pharmacy_account: true,
      clinic,
      account: { email: c?.email ?? null },
      subscription: sub,
      device: mine
        ? {
            registered: true,
            revoked: mine.is_revoked,
            id: mine.id,
            name: mine.name,
            register_no: mine.register_no,
          }
        : { registered: false, revoked: false, id: null, name: null, register_no: null },
      devices_used: devs.filter((d) => !d.is_revoked).length,
      operators_count: ops.length,
      has_admin: ops.some((o) => o.role === 'admin'),
      operator,
    };
  }

  // ----------------------------------------------------------- qurilmalar ----
  async registerDevice(
    clinicId: string,
    userId: string,
    input: z.infer<typeof DeviceRegisterSchema>,
    meta: { userAgent: string | null; ip: string | null },
  ) {
    const sub = await this.subscription(clinicId);
    if (!sub.active) {
      throw new ForbiddenException({
        error: 'PHARMACY_SUBSCRIPTION_INACTIVE',
        message: 'Dorixona obunasi faol emas',
      });
    }
    const admin = this.supabase.admin();
    const hash = sha256Hex(input.device_key);
    const { data: existing } = await admin
      .from('pharmacy_devices')
      .select('id, name, register_no, is_revoked')
      .eq('clinic_id', clinicId)
      .eq('device_key_hash', hash)
      .maybeSingle();
    if (existing) {
      const ex = existing as { id: string; is_revoked: boolean };
      if (ex.is_revoked) {
        throw new ForbiddenException({
          error: 'DEVICE_REVOKED',
          message:
            "Bu kompyuter admin tomonidan o'chirilgan. Admin Sozlamalarda qayta tiklashi kerak.",
        });
      }
      await admin
        .from('pharmacy_devices')
        .update({
          last_seen_at: new Date().toISOString(),
          user_agent: meta.userAgent,
          last_ip: meta.ip,
        })
        .eq('id', ex.id);
      return existing;
    }

    const { data: active } = await admin
      .from('pharmacy_devices')
      .select('id, name, last_seen_at')
      .eq('clinic_id', clinicId)
      .eq('is_revoked', false);
    const used = (active ?? []) as Array<{ id: string; name: string; last_seen_at: string }>;
    if (used.length >= sub.max_devices) {
      throw new ConflictException({
        error: 'DEVICE_LIMIT',
        message: `Qurilmalar limiti to'lgan (${used.length}/${sub.max_devices}). Admin eski kompyuterni o'chirsin yoki Clary administratoriga murojaat qiling.`,
        details: used.map((d) => ({ name: d.name, last_seen_at: d.last_seen_at })),
      });
    }
    const { data, error } = await admin
      .from('pharmacy_devices')
      .insert({
        clinic_id: clinicId,
        user_id: userId,
        device_key_hash: hash,
        name: input.name.trim(),
        register_no: input.register_no ?? null,
        user_agent: meta.userAgent,
        last_ip: meta.ip,
      })
      .select('id, name, register_no, is_revoked')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async listDevices(clinicId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('pharmacy_devices')
      .select(
        'id, name, register_no, user_agent, last_ip, last_seen_at, is_revoked, revoked_at, created_at',
      )
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async updateDevice(clinicId: string, id: string, input: z.infer<typeof DeviceUpdateSchema>) {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch['name'] = input.name.trim();
    if (input.register_no !== undefined) patch['register_no'] = input.register_no;
    const { data, error } = await this.supabase
      .admin()
      .from('pharmacy_devices')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select('id, name, register_no, is_revoked')
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async revokeDevice(clinicId: string, userId: string, id: string) {
    const admin = this.supabase.admin();
    const { error } = await admin
      .from('pharmacy_devices')
      .update({ is_revoked: true, revoked_at: new Date().toISOString(), revoked_by: userId })
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    await admin
      .from('pharmacy_operator_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('clinic_id', clinicId)
      .eq('device_id', id)
      .is('revoked_at', null);
    return { ok: true };
  }

  async restoreDevice(clinicId: string, id: string) {
    const sub = await this.subscription(clinicId);
    const admin = this.supabase.admin();
    const { count } = await admin
      .from('pharmacy_devices')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('is_revoked', false);
    if ((count ?? 0) >= sub.max_devices) {
      throw new ConflictException(`Qurilmalar limiti to'lgan (${count}/${sub.max_devices})`);
    }
    const { error } = await admin
      .from('pharmacy_devices')
      .update({ is_revoked: false, revoked_at: null, revoked_by: null })
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // ----------------------------------------------------------- operatorlar ---
  async loginList(clinicId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('pharmacy_operators')
      .select('id, full_name, role, register_no, pin_locked_until, sort_order')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('role', { ascending: true })
      .order('register_no', { ascending: true, nullsFirst: true })
      .order('sort_order', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async setup(
    clinicId: string,
    userId: string,
    deviceId: string,
    input: z.infer<typeof OperatorSetupSchema>,
  ) {
    const admin = this.supabase.admin();
    const { count } = await admin
      .from('pharmacy_operators')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId);
    if ((count ?? 0) > 0) {
      throw new ConflictException('Admin allaqachon yaratilgan — PIN bilan kiring');
    }
    const pinHash = await argon2.hash(input.pin, ARGON2_OPTIONS);
    const { data, error } = await admin
      .from('pharmacy_operators')
      .insert({
        clinic_id: clinicId,
        full_name: input.full_name.trim(),
        role: 'admin',
        register_no: null,
        pin_hash: pinHash,
        can_return: true,
        can_receive: true,
        can_discount: true,
        created_by: userId,
        updated_by: userId,
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    return this.createSession(clinicId, (data as { id: string }).id, deviceId);
  }

  async login(clinicId: string, deviceId: string, input: z.infer<typeof OperatorLoginSchema>) {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('pharmacy_operators')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('id', input.operator_id)
      .maybeSingle();
    const op = data as OperatorRow | null;
    if (!op || !op.is_active) throw new NotFoundException('Operator topilmadi');
    if (op.pin_locked_until && new Date(op.pin_locked_until).getTime() > Date.now()) {
      const mins = Math.ceil((new Date(op.pin_locked_until).getTime() - Date.now()) / 60_000);
      throw new ForbiddenException(
        `PIN vaqtincha bloklangan — ${mins} daqiqadan keyin urinib ko'ring`,
      );
    }
    const ok = await argon2.verify(op.pin_hash, input.pin).catch(() => false);
    if (!ok) {
      const attempts = op.pin_failed_attempts + 1;
      await admin
        .from('pharmacy_operators')
        .update({
          pin_failed_attempts: attempts,
          pin_locked_until:
            attempts >= MAX_PIN_ATTEMPTS
              ? new Date(Date.now() + PIN_LOCK_MINUTES * 60_000).toISOString()
              : null,
        })
        .eq('id', op.id);
      throw new UnauthorizedException(
        attempts >= MAX_PIN_ATTEMPTS
          ? `PIN ${MAX_PIN_ATTEMPTS} marta xato — ${PIN_LOCK_MINUTES} daqiqaga bloklandi`
          : `Noto'g'ri PIN (${MAX_PIN_ATTEMPTS - attempts} ta urinish qoldi)`,
      );
    }
    if (op.pin_failed_attempts > 0 || op.pin_locked_until) {
      await admin
        .from('pharmacy_operators')
        .update({ pin_failed_attempts: 0, pin_locked_until: null })
        .eq('id', op.id);
    }
    return this.createSession(clinicId, op.id, deviceId);
  }

  async logout(clinicId: string, token: string | null) {
    if (!token) return { ok: true };
    await this.supabase
      .admin()
      .from('pharmacy_operator_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('clinic_id', clinicId)
      .eq('token_hash', sha256Hex(token));
    return { ok: true };
  }

  private async createSession(clinicId: string, operatorId: string, deviceId: string) {
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + SESSION_HOURS * 3_600_000).toISOString();
    const admin = this.supabase.admin();
    const { error } = await admin.from('pharmacy_operator_sessions').insert({
      clinic_id: clinicId,
      operator_id: operatorId,
      device_id: deviceId,
      token_hash: sha256Hex(token),
      expires_at: expires,
    });
    if (error) throw new BadRequestException(error.message);
    const { data: op } = await admin
      .from('pharmacy_operators')
      .select(OP_PUBLIC)
      .eq('id', operatorId)
      .single();
    return { token, expires_at: expires, operator: op };
  }

  async listOperators(clinicId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('pharmacy_operators')
      .select(OP_PUBLIC)
      .eq('clinic_id', clinicId)
      .order('is_active', { ascending: false })
      .order('role', { ascending: true })
      .order('register_no', { ascending: true, nullsFirst: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createOperator(
    clinicId: string,
    userId: string,
    input: z.infer<typeof OperatorCreateSchema>,
  ) {
    const pinHash = await argon2.hash(input.pin, ARGON2_OPTIONS);
    const isAdmin = input.role === 'admin';
    const { data, error } = await this.supabase
      .admin()
      .from('pharmacy_operators')
      .insert({
        clinic_id: clinicId,
        full_name: input.full_name.trim(),
        role: input.role,
        register_no: isAdmin ? (input.register_no ?? null) : (input.register_no ?? 1),
        pin_hash: pinHash,
        can_return: isAdmin || !!input.can_return,
        can_receive: isAdmin || !!input.can_receive,
        can_discount: isAdmin || (input.can_discount ?? true),
        created_by: userId,
        updated_by: userId,
      })
      .select(OP_PUBLIC)
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateOperator(
    clinicId: string,
    userId: string,
    id: string,
    input: z.infer<typeof OperatorUpdateSchema>,
  ) {
    const admin = this.supabase.admin();
    const { data: cur } = await admin
      .from('pharmacy_operators')
      .select('id, role, is_active')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .maybeSingle();
    if (!cur) throw new NotFoundException('Operator topilmadi');
    const current = cur as { role: string; is_active: boolean };

    // Oxirgi faol adminni o'chirib/kassirga aylantirib bo'lmaydi — aks holda
    // hech kim sozlamalarga kira olmay qoladi.
    const demotes =
      current.role === 'admin' &&
      ((input.role && input.role !== 'admin') || input.is_active === false);
    if (demotes) {
      const { count } = await admin
        .from('pharmacy_operators')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('role', 'admin')
        .eq('is_active', true);
      if ((count ?? 0) <= 1) {
        throw new BadRequestException('Kamida bitta faol admin qolishi kerak');
      }
    }

    const patch: Record<string, unknown> = {
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };
    if (input.full_name !== undefined) patch['full_name'] = input.full_name.trim();
    if (input.role !== undefined) patch['role'] = input.role;
    if (input.register_no !== undefined) patch['register_no'] = input.register_no;
    if (input.can_return !== undefined) patch['can_return'] = input.can_return;
    if (input.can_receive !== undefined) patch['can_receive'] = input.can_receive;
    if (input.can_discount !== undefined) patch['can_discount'] = input.can_discount;
    if (input.is_active !== undefined) patch['is_active'] = input.is_active;
    if (input.pin) {
      patch['pin_hash'] = await argon2.hash(input.pin, ARGON2_OPTIONS);
      patch['pin_failed_attempts'] = 0;
      patch['pin_locked_until'] = null;
    }
    const { data, error } = await admin
      .from('pharmacy_operators')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select(OP_PUBLIC)
      .single();
    if (error) throw new BadRequestException(error.message);

    // PIN o'zgarsa yoki o'chirilsa — ochiq sessiyalar yopiladi
    if (input.pin || input.is_active === false || input.role !== undefined) {
      await admin
        .from('pharmacy_operator_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('clinic_id', clinicId)
        .eq('operator_id', id)
        .is('revoked_at', null);
    }
    return data;
  }
}
