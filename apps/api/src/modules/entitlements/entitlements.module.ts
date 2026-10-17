import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Global,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  DEVICE_CLIENT_OPTIONS,
  ENTITLEMENT_GROUPS,
  ENTITLEMENT_MODULES,
  PAYMENT_METHOD_OPTIONS,
  ROLE_OPTIONS,
  moduleEnabled,
  normalizeEntitlements,
  type Entitlements,
} from '@clary/schemas';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DeviceRegistryService } from '../../common/entitlements/device-registry.service';
import { EntitlementsService } from '../../common/entitlements/entitlements.service';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { PERMISSION_MODULES, ROLE_DEFAULT_PERMISSIONS } from '../../common/rbac/permissions';
import { SupabaseService } from '../../common/services/supabase.service';
import { syncPlanToSiteEntry } from '../../common/site/plan-site-sync';

// =============================================================================
// TARIF MUHARRIRI va klinikaga individual yondashuv (super-admin), klinika
// qurilmalari, ochiq tariflar ro'yxati (landing). Tuzilma va katalog —
// packages/schemas/src/entitlements.ts; birlashtirish — bazada
// (clinic_effective_entitlements, migratsiya 20261018000001).
// =============================================================================

const MODULE_KEYS = new Set<string>(ENTITLEMENT_MODULES.map((m) => m.key));
const METHOD_KEYS = new Set(PAYMENT_METHOD_OPTIONS.map((m) => m.key));
const ROLE_KEYS = new Set(ROLE_OPTIONS.map((r) => r.key));
const STAFF_ROLES = [
  'clinic_owner',
  'clinic_admin',
  'doctor',
  'receptionist',
  'cashier',
  'pharmacist',
  'lab_technician',
  'radiologist',
  'nurse',
  'staff',
] as const;

const limitNum = z.number().int().min(0).max(1_000_000).nullable();

/** Tarif yoki kelishuv imkoniyatlari (qisman). Noma'lum kalitlar tashlanadi. */
const EntitlementsPatch = z
  .object({
    modules: z
      .record(z.string(), z.boolean())
      .transform((m) => Object.fromEntries(Object.entries(m).filter(([k]) => MODULE_KEYS.has(k))))
      .optional(),
    journal: z
      .object({
        history_days: z.number().int().min(1).max(3650).nullable(),
        allow_edit: z.boolean(),
        allow_delete: z.boolean(),
        allow_export: z.boolean(),
      })
      .partial()
      .optional(),
    payments: z
      .object({
        methods: z
          .array(z.string())
          .transform((a) => [...new Set(a.filter((x) => METHOD_KEYS.has(x)))])
          .nullable(),
      })
      .partial()
      .optional(),
    roles: z
      .object({
        allowed: z
          .array(z.string())
          .transform((a) => [...new Set(a.filter((x) => ROLE_KEYS.has(x)))])
          .nullable(),
        custom_roles: z.boolean(),
      })
      .partial()
      .optional(),
    devices: z
      .object({
        clients: z
          .object({
            web: z.boolean(),
            desktop: z.boolean(),
            mobile: z.boolean(),
            kiosk: z.boolean(),
          })
          .partial(),
        enforce_limit: z.boolean(),
      })
      .partial()
      .optional(),
    limits: z
      .object({ max_staff: limitNum, max_devices: limitNum, max_patients: limitNum })
      .partial()
      .optional(),
  })
  .strip();

type EntPatch = z.infer<typeof EntitlementsPatch>;

/** Bo'sh qismlarni olib tashlaydi — bazada faqat ma'noli kalitlar qoladi. */
function compact(p: EntPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v == null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const inner = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined),
      );
      if (k === 'devices' && inner.clients && Object.keys(inner.clients as object).length === 0) {
        delete inner.clients;
      }
      if (Object.keys(inner).length > 0) out[k] = inner;
    }
  }
  return out;
}

const PlanUpdate = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  price_uzs: z.number().int().min(0).optional(),
  price_yearly_uzs: z.number().int().min(0).optional(),
  max_staff: limitNum.optional(),
  max_devices: limitNum.optional(),
  max_patients: limitNum.optional(),
  is_active: z.boolean().optional(),
  is_public: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(100).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  highlights: z.array(z.string().trim().min(1).max(160)).max(16).optional(),
  entitlements: EntitlementsPatch.optional(),
});

const ClinicOverride = z.object({
  overrides: EntitlementsPatch.default({}),
  custom_price_uzs: z.number().int().min(0).nullable().optional(),
  custom_price_yearly_uzs: z.number().int().min(0).nullable().optional(),
  discount_percent: z.number().min(0).max(100).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  valid_until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

const DevicePatch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  is_revoked: z.boolean().optional(),
  is_trusted: z.boolean().optional(),
});

const StaffPatch = z.object({
  role: z.enum(STAFF_ROLES).optional(),
  custom_role_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
});

const CustomRoleInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  base_role: z.enum(STAFF_ROLES).default('staff'),
  permissions: z.record(z.string(), z.boolean()).default({}),
});

type PlanRow = {
  id: string;
  code: string;
  name: string;
  price_uzs: number | null;
  price_yearly_uzs: number | null;
  max_staff: number | null;
  max_devices: number | null;
  max_patients: number | null;
  is_active: boolean;
  is_public?: boolean;
  sort_order: number;
  description?: string | null;
  highlights?: unknown;
  entitlements?: unknown;
};

const PLAN_COLS =
  'id, code, name, price_uzs, price_yearly_uzs, max_staff, max_devices, max_patients, is_active, is_public, sort_order, description, highlights, entitlements, updated_at';

/** Tarif qatoridan to'liq (normallashtirilgan) imkoniyatlar. */
function planEntitlements(p: PlanRow): Entitlements {
  const raw = (
    p.entitlements && typeof p.entitlements === 'object' ? p.entitlements : {}
  ) as Record<string, unknown>;
  return normalizeEntitlements({
    ...raw,
    plan: p.code,
    plan_name: p.name,
    limits: { max_staff: p.max_staff, max_devices: p.max_devices, max_patients: p.max_patients },
  });
}

@Injectable()
export class EntitlementsAdminService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly entitlements: EntitlementsService,
    private readonly devices: DeviceRegistryService,
  ) {}

  private get db() {
    return this.supabase.admin();
  }

  catalog() {
    return {
      groups: ENTITLEMENT_GROUPS,
      modules: ENTITLEMENT_MODULES.map((m) => ({
        key: m.key,
        label: m.label,
        description: m.description,
        group: m.group,
      })),
      payment_methods: PAYMENT_METHOD_OPTIONS,
      roles: ROLE_OPTIONS,
      clients: DEVICE_CLIENT_OPTIONS,
      permission_modules: PERMISSION_MODULES,
      role_defaults: ROLE_DEFAULT_PERMISSIONS,
    };
  }

  private async audit(row: {
    scope: 'plan' | 'clinic';
    plan_code?: string | null;
    clinic_id?: string | null;
    actor_id: string | null;
    action: string;
    before: unknown;
    after: unknown;
  }) {
    await this.db
      .from('entitlement_changes')
      .insert({
        scope: row.scope,
        plan_code: row.plan_code ?? null,
        clinic_id: row.clinic_id ?? null,
        actor_id: row.actor_id,
        action: row.action,
        before: row.before ?? null,
        after: row.after ?? null,
      })
      .then(undefined, () => undefined);
  }

  // ── Tariflar ─────────────────────────────────────────────────────────────
  async listPlans() {
    const [{ data: plans, error }, { data: clinics }] = await Promise.all([
      this.db.from('plans').select(PLAN_COLS).order('sort_order'),
      this.db
        .from('clinics')
        .select('current_plan, subscription_status')
        .is('deleted_at', null)
        .neq('organization_type', 'pharmacy'),
    ]);
    if (error) throw new BadRequestException(error.message);
    const counts = new Map<string, { total: number; active: number }>();
    for (const c of (clinics ?? []) as Array<{
      current_plan: string;
      subscription_status: string;
    }>) {
      const r = counts.get(c.current_plan) ?? { total: 0, active: 0 };
      r.total += 1;
      if (c.subscription_status === 'active' || c.subscription_status === 'trialing') r.active += 1;
      counts.set(c.current_plan, r);
    }
    return ((plans ?? []) as PlanRow[]).map((p) => ({
      ...p,
      highlights: Array.isArray(p.highlights) ? p.highlights : [],
      entitlements: planEntitlements(p),
      clinics: counts.get(p.code) ?? { total: 0, active: 0 },
    }));
  }

  async updatePlan(actor: string | null, code: string, body: unknown) {
    const input = PlanUpdate.parse(body ?? {});
    const { data: before } = await this.db
      .from('plans')
      .select(PLAN_COLS)
      .eq('code', code)
      .maybeSingle();
    if (!before) throw new NotFoundException('Tarif topilmadi');

    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined || k === 'entitlements') continue;
      patch[k] = v;
    }
    if (input.entitlements) {
      // Tarifda limitlar ustunlarda saqlanadi — entitlements ichida emas
      const { limits: _ignored, ...rest } = input.entitlements;
      patch.entitlements = compact(rest);
    }
    if (Object.keys(patch).length === 0)
      throw new BadRequestException("Hech narsa o'zgartirilmadi");

    const { data, error } = await this.db
      .from('plans')
      .update(patch)
      .eq('code', code)
      .select(PLAN_COLS)
      .single();
    if (error) throw new BadRequestException(error.message);

    await this.audit({
      scope: 'plan',
      plan_code: code,
      actor_id: actor,
      action: 'update',
      before,
      after: data,
    });
    this.entitlements.invalidate();
    await syncPlanToSiteEntry(this.db, code, data as Record<string, unknown>).catch(
      () => undefined,
    );
    return { ...(data as PlanRow), entitlements: planEntitlements(data as PlanRow) };
  }

  /** Bir tarifning imkoniyatlarini boshqasiga ko'chirish (shablon sifatida). */
  async copyPlan(actor: string | null, code: string, fromCode: string) {
    const { data: src } = await this.db
      .from('plans')
      .select('entitlements')
      .eq('code', fromCode)
      .maybeSingle();
    if (!src) throw new NotFoundException('Manba tarif topilmadi');
    return this.updatePlan(actor, code, {
      entitlements: (src as { entitlements: unknown }).entitlements ?? {},
    });
  }

  // ── Klinikaga individual yondashuv ───────────────────────────────────────
  async getClinic(clinicId: string) {
    const db = this.db;
    const { data: clinic } = await db
      .from('clinics')
      .select(
        'id, name, current_plan, subscription_status, subscription_ends_at, trial_ends_at, is_hq, company_id, organization_type',
      )
      .eq('id', clinicId)
      .maybeSingle();
    if (!clinic) throw new NotFoundException('Klinika topilmadi');
    const c = clinic as { current_plan: string };

    const [planRes, ovRes, effRes, staff, devices, patients, history] = await Promise.all([
      db.from('plans').select(PLAN_COLS).eq('code', c.current_plan).maybeSingle(),
      db.from('clinic_entitlements').select('*').eq('clinic_id', clinicId).maybeSingle(),
      db.rpc('clinic_effective_entitlements' as never, { p_clinic: clinicId } as never),
      db
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('is_active', true),
      db
        .from('user_devices')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('is_revoked', false),
      db
        .from('patients')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .is('deleted_at', null),
      db
        .from('entitlement_changes')
        .select('id, action, actor_id, before, after, created_at')
        .eq('clinic_id', clinicId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);
    if (effRes.error) throw new BadRequestException(effRes.error.message);

    return {
      clinic,
      plan: planRes.data
        ? { ...(planRes.data as PlanRow), entitlements: planEntitlements(planRes.data as PlanRow) }
        : null,
      override: ovRes.data ?? null,
      effective: normalizeEntitlements(effRes.data),
      usage: {
        staff: staff.count ?? 0,
        devices: devices.count ?? 0,
        patients: patients.count ?? 0,
      },
      history: history.data ?? [],
    };
  }

  async saveClinic(actor: string | null, clinicId: string, body: unknown) {
    const input = ClinicOverride.parse(body ?? {});
    const { data: before } = await this.db
      .from('clinic_entitlements')
      .select('*')
      .eq('clinic_id', clinicId)
      .maybeSingle();
    const row = {
      clinic_id: clinicId,
      overrides: compact(input.overrides),
      custom_price_uzs: input.custom_price_uzs ?? null,
      custom_price_yearly_uzs: input.custom_price_yearly_uzs ?? null,
      discount_percent: input.discount_percent ?? null,
      note: input.note ?? null,
      valid_until: input.valid_until ?? null,
      updated_by: actor,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await this.db
      .from('clinic_entitlements')
      .upsert(row, { onConflict: 'clinic_id' })
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    await this.audit({
      scope: 'clinic',
      clinic_id: clinicId,
      actor_id: actor,
      action: before ? 'update' : 'create',
      before,
      after: data,
    });
    // HQ kelishuvi filiallarga ham ta'sir qiladi — butun kesh tozalanadi
    this.entitlements.invalidate();
    return this.getClinic(clinicId);
  }

  async resetClinic(actor: string | null, clinicId: string) {
    const { data: before } = await this.db
      .from('clinic_entitlements')
      .select('*')
      .eq('clinic_id', clinicId)
      .maybeSingle();
    if (!before) return this.getClinic(clinicId);
    const { error } = await this.db.from('clinic_entitlements').delete().eq('clinic_id', clinicId);
    if (error) throw new BadRequestException(error.message);
    await this.audit({
      scope: 'clinic',
      clinic_id: clinicId,
      actor_id: actor,
      action: 'reset',
      before,
      after: null,
    });
    this.entitlements.invalidate();
    return this.getClinic(clinicId);
  }

  async history(params: { clinic_id?: string; plan_code?: string; limit?: number }) {
    let q = this.db
      .from('entitlement_changes')
      .select('id, scope, plan_code, clinic_id, action, actor_id, before, after, created_at')
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(params.limit ?? 50, 1), 200));
    if (params.clinic_id) q = q.eq('clinic_id', params.clinic_id);
    if (params.plan_code) q = q.eq('plan_code', params.plan_code);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as Array<{ actor_id: string | null }>;
    const ids = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: ps } = await this.db
        .from('profiles')
        .select('id, full_name, email')
        .in('id', ids);
      for (const p of (ps ?? []) as Array<{
        id: string;
        full_name: string | null;
        email: string;
      }>) {
        names.set(p.id, p.full_name || p.email);
      }
    }
    return rows.map((r) => ({
      ...r,
      actor_name: r.actor_id ? (names.get(r.actor_id) ?? null) : null,
    }));
  }

  // ── Qurilmalar ───────────────────────────────────────────────────────────
  async listDevices(clinicId: string) {
    const { data, error } = await this.db
      .from('user_devices')
      .select(
        'id, user_id, kind, client, fingerprint, name, os, browser, app_version, last_ip, last_used_at, is_trusted, is_revoked, revoked_at, created_at',
      )
      .eq('clinic_id', clinicId)
      .order('last_used_at', { ascending: false })
      .limit(500);
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as Array<{ user_id: string }>;
    const ids = [...new Set(rows.map((r) => r.user_id))];
    const users = new Map<string, { full_name: string | null; email: string; role: string }>();
    if (ids.length) {
      const { data: ps } = await this.db
        .from('profiles')
        .select('id, full_name, email, role')
        .in('id', ids);
      for (const p of (ps ?? []) as Array<{
        id: string;
        full_name: string | null;
        email: string;
        role: string;
      }>) {
        users.set(p.id, p);
      }
    }
    return rows.map((r) => ({
      ...r,
      user_name: users.get(r.user_id)?.full_name ?? users.get(r.user_id)?.email ?? null,
      user_role: users.get(r.user_id)?.role ?? null,
    }));
  }

  async updateDevice(clinicId: string, deviceId: string, actor: string | null, body: unknown) {
    const input = DevicePatch.parse(body ?? {});
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.is_trusted !== undefined) patch.is_trusted = input.is_trusted;
    if (input.is_revoked !== undefined) {
      patch.is_revoked = input.is_revoked;
      patch.revoked_at = input.is_revoked ? new Date().toISOString() : null;
      patch.revoked_by = input.is_revoked ? actor : null;
    }
    if (Object.keys(patch).length === 0)
      throw new BadRequestException("Hech narsa o'zgartirilmadi");
    const { data, error } = await this.db
      .from('user_devices')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', deviceId)
      .select('id, fingerprint, is_revoked, name')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Qurilma topilmadi');
    this.devices.invalidate(clinicId, (data as { fingerprint: string }).fingerprint);
    return data;
  }

  async deleteDevice(clinicId: string, deviceId: string) {
    const { data, error } = await this.db
      .from('user_devices')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('id', deviceId)
      .select('id, fingerprint')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Qurilma topilmadi');
    this.devices.invalidate(clinicId, (data as { fingerprint: string }).fingerprint);
    return { ok: true };
  }

  // ── Rollar va xodimlar ───────────────────────────────────────────────────
  async getRoles(clinicId: string) {
    const [staff, roles] = await Promise.all([
      this.db
        .from('profiles')
        .select(
          'id, full_name, email, role, custom_role_id, is_active, last_sign_in_at, created_at',
        )
        .eq('clinic_id', clinicId)
        .order('created_at'),
      this.db
        .from('custom_roles')
        .select(
          'id, name, description, base_role, permissions, is_archived, created_at, updated_at',
        )
        .eq('clinic_id', clinicId)
        .order('name'),
    ]);
    if (staff.error) throw new BadRequestException(staff.error.message);
    const list = (staff.data ?? []) as Array<{ custom_role_id: string | null }>;
    const usage = new Map<string, number>();
    for (const s of list) {
      if (s.custom_role_id) usage.set(s.custom_role_id, (usage.get(s.custom_role_id) ?? 0) + 1);
    }
    return {
      staff: list,
      custom_roles: ((roles.data ?? []) as Array<{ id: string }>).map((r) => ({
        ...r,
        assigned: usage.get(r.id) ?? 0,
      })),
      permission_modules: PERMISSION_MODULES,
      role_defaults: ROLE_DEFAULT_PERMISSIONS,
    };
  }

  async updateStaff(clinicId: string, userId: string, body: unknown) {
    const input = StaffPatch.parse(body ?? {});
    const { data: prof } = await this.db
      .from('profiles')
      .select('id, role')
      .eq('clinic_id', clinicId)
      .eq('id', userId)
      .maybeSingle();
    if (!prof) throw new NotFoundException('Xodim topilmadi');

    if (input.role && input.role !== (prof as { role: string }).role) {
      // profiles.role va JWT (app_metadata.role) birga yangilanadi
      const { error } = await this.db.rpc(
        'set_user_clinic' as never,
        { p_user_id: userId, p_clinic_id: clinicId, p_role: input.role } as never,
      );
      if (error) throw new BadRequestException(error.message);
    }
    const patch: Record<string, unknown> = {};
    if (input.custom_role_id !== undefined) {
      if (input.custom_role_id) {
        const { data: r } = await this.db
          .from('custom_roles')
          .select('id')
          .eq('clinic_id', clinicId)
          .eq('id', input.custom_role_id)
          .maybeSingle();
        if (!r) throw new BadRequestException('Rol bu klinikaga tegishli emas');
      }
      patch.custom_role_id = input.custom_role_id;
    }
    if (input.is_active !== undefined) patch.is_active = input.is_active;
    if (Object.keys(patch).length > 0) {
      const { error } = await this.db
        .from('profiles')
        .update(patch)
        .eq('clinic_id', clinicId)
        .eq('id', userId);
      if (error) throw new BadRequestException(error.message);
    }
    return { ok: true };
  }

  async createCustomRole(clinicId: string, actor: string | null, body: unknown) {
    const input = CustomRoleInput.parse(body ?? {});
    const { data, error } = await this.db
      .from('custom_roles')
      .insert({
        clinic_id: clinicId,
        name: input.name,
        description: input.description ?? null,
        base_role: input.base_role,
        permissions: input.permissions,
        created_by: actor,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateCustomRole(clinicId: string, roleId: string, actor: string | null, body: unknown) {
    const input = CustomRoleInput.partial()
      .extend({ is_archived: z.boolean().optional() })
      .parse(body ?? {});
    const patch: Record<string, unknown> = { updated_by: actor };
    for (const [k, v] of Object.entries(input)) if (v !== undefined) patch[k] = v;
    const { data, error } = await this.db
      .from('custom_roles')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', roleId)
      .select()
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Rol topilmadi');
    return data;
  }

  /** Rolni o'chirish: avval xodimlardan olinadi; bog'liqlik qolsa — arxivlanadi. */
  async deleteCustomRole(clinicId: string, roleId: string) {
    const { error: unErr } = await this.db
      .from('profiles')
      .update({ custom_role_id: null })
      .eq('clinic_id', clinicId)
      .eq('custom_role_id', roleId);
    if (unErr) throw new BadRequestException(unErr.message);
    const { error } = await this.db
      .from('custom_roles')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('id', roleId);
    if (error) {
      await this.db
        .from('custom_roles')
        .update({ is_archived: true })
        .eq('clinic_id', clinicId)
        .eq('id', roleId);
      return { ok: true, archived: true };
    }
    return { ok: true, archived: false };
  }

  // ── Ochiq tariflar (landing) ─────────────────────────────────────────────
  async publicPlans() {
    const { data, error } = await this.db
      .from('plans')
      .select(PLAN_COLS)
      .eq('is_active', true)
      .eq('is_public', true)
      .order('sort_order');
    if (error) throw new BadRequestException(error.message);
    return {
      groups: ENTITLEMENT_GROUPS,
      modules: ENTITLEMENT_MODULES.map((m) => ({
        key: m.key,
        label: m.label,
        description: m.description,
        group: m.group,
      })),
      plans: ((data ?? []) as PlanRow[]).map((p) => {
        const e = planEntitlements(p);
        return {
          code: p.code,
          name: p.name,
          price_uzs: p.price_uzs,
          price_yearly_uzs: p.price_yearly_uzs,
          description: p.description ?? null,
          highlights: Array.isArray(p.highlights) ? p.highlights : [],
          limits: e.limits,
          modules: ENTITLEMENT_MODULES.filter((m) => moduleEnabled(e, m.key)).map((m) => m.key),
          payments: e.payments,
          journal: e.journal,
          roles: e.roles,
          devices: e.devices,
        };
      }),
    };
  }
}

// ── Klinika: o'z imkoniyatlari va qurilmalari ──────────────────────────────
@ApiTags('entitlements')
@Controller('entitlements')
class EntitlementsController {
  constructor(
    private readonly entitlements: EntitlementsService,
    private readonly svc: EntitlementsAdminService,
  ) {}

  @Get('me')
  me(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.entitlements.getOrDefault(u.clinicId);
  }

  @Get('devices')
  @Roles('clinic_owner', 'clinic_admin')
  devices(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listDevices(u.clinicId);
  }

  @Patch('devices/:id')
  @Roles('clinic_owner', 'clinic_admin')
  updateDevice(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    // Klinika egasi faqat nom va bloklashni boshqaradi ("ishonchli" — super-admin)
    const { name, is_revoked } = (body ?? {}) as { name?: string; is_revoked?: boolean };
    return this.svc.updateDevice(u.clinicId, id, u.userId, { name, is_revoked });
  }

  @Delete('devices/:id')
  @Roles('clinic_owner', 'clinic_admin')
  deleteDevice(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.deleteDevice(u.clinicId, id);
  }
}

// ── Ochiq: landing narxlar sahifasi ────────────────────────────────────────
@ApiTags('public')
@Controller('public/plans')
class PublicPlansController {
  constructor(private readonly svc: EntitlementsAdminService) {}

  @Get()
  @Public()
  list() {
    return this.svc.publicPlans();
  }
}

// ── Super-admin ────────────────────────────────────────────────────────────
@ApiTags('admin')
@Controller('admin/entitlements')
@UseGuards(SuperAdminGuard)
class AdminEntitlementsController {
  constructor(private readonly svc: EntitlementsAdminService) {}

  @Get('catalog')
  catalog() {
    return this.svc.catalog();
  }

  @Get('plans')
  plans() {
    return this.svc.listPlans();
  }

  @Patch('plans/:code')
  updatePlan(
    @CurrentUser() u: { userId: string | null },
    @Param('code') code: string,
    @Body() body: unknown,
  ) {
    return this.svc.updatePlan(u.userId, code, body);
  }

  @Post('plans/:code/copy-from/:from')
  copyPlan(
    @CurrentUser() u: { userId: string | null },
    @Param('code') code: string,
    @Param('from') from: string,
  ) {
    return this.svc.copyPlan(u.userId, code, from);
  }

  @Get('history')
  history(
    @Query('clinic_id') clinicId?: string,
    @Query('plan_code') planCode?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.history({
      clinic_id: clinicId || undefined,
      plan_code: planCode || undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('clinics/:id')
  clinic(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getClinic(id);
  }

  @Put('clinics/:id')
  saveClinic(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.svc.saveClinic(u.userId, id, body);
  }

  @Delete('clinics/:id')
  resetClinic(@CurrentUser() u: { userId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.resetClinic(u.userId, id);
  }

  @Get('clinics/:id/devices')
  devices(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.listDevices(id);
  }

  @Patch('clinics/:id/devices/:deviceId')
  updateDevice(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() body: unknown,
  ) {
    return this.svc.updateDevice(id, deviceId, u.userId, body);
  }

  @Delete('clinics/:id/devices/:deviceId')
  deleteDevice(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    return this.svc.deleteDevice(id, deviceId);
  }

  @Get('clinics/:id/roles')
  roles(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getRoles(id);
  }

  @Patch('clinics/:id/staff/:userId')
  updateStaff(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: unknown,
  ) {
    return this.svc.updateStaff(id, userId, body);
  }

  @Post('clinics/:id/custom-roles')
  createRole(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.svc.createCustomRole(id, u.userId, body);
  }

  @Patch('clinics/:id/custom-roles/:roleId')
  updateRole(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() body: unknown,
  ) {
    return this.svc.updateCustomRole(id, roleId, u.userId, body);
  }

  @Delete('clinics/:id/custom-roles/:roleId')
  deleteRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ) {
    return this.svc.deleteCustomRole(id, roleId);
  }
}

@Global()
@Module({
  controllers: [EntitlementsController, PublicPlansController, AdminEntitlementsController],
  providers: [
    EntitlementsService,
    DeviceRegistryService,
    EntitlementsAdminService,
    SupabaseService,
  ],
  exports: [EntitlementsService, DeviceRegistryService],
})
export class EntitlementsModule {}
