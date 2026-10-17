// Tarif imkoniyatlari (entitlements) — API javob turlari.
// Tuzilma packages/schemas/src/entitlements.ts dagi `Entitlements` bilan bir xil
// (api-client @clary/schemas ga bog'lanmaydi — turlar shu yerda takrorlangan).

export type DeviceClientKind = 'web' | 'desktop' | 'mobile' | 'kiosk';

export interface EntitlementsData {
  plan: string | null;
  plan_name: string | null;
  modules: Record<string, boolean>;
  limits: { max_staff: number | null; max_devices: number | null; max_patients: number | null };
  journal: {
    history_days: number | null;
    allow_edit: boolean;
    allow_delete: boolean;
    allow_export: boolean;
  };
  payments: { methods: string[] | null };
  roles: { allowed: string[] | null; custom_roles: boolean };
  devices: { clients: Record<DeviceClientKind, boolean>; enforce_limit: boolean };
  override?: {
    active: boolean;
    custom_price_uzs: number | null;
    custom_price_yearly_uzs: number | null;
    discount_percent: number | null;
    valid_until: string | null;
    note: string | null;
  } | null;
}

/** Qisman imkoniyatlar — tarif/kelishuvga yoziladigan qism. */
export interface EntitlementsPatch {
  modules?: Record<string, boolean>;
  journal?: Partial<EntitlementsData['journal']>;
  payments?: Partial<EntitlementsData['payments']>;
  roles?: Partial<EntitlementsData['roles']>;
  devices?: {
    clients?: Partial<Record<DeviceClientKind, boolean>>;
    enforce_limit?: boolean;
  };
  limits?: Partial<EntitlementsData['limits']>;
}

export interface EntitlementCatalog {
  groups: Array<{ key: string; label: string }>;
  modules: Array<{ key: string; label: string; description: string; group: string }>;
  payment_methods: Array<{ key: string; label: string }>;
  roles: Array<{ key: string; label: string }>;
  clients: Array<{ key: DeviceClientKind; label: string }>;
  permission_modules: Record<string, readonly string[]>;
  role_defaults: Record<string, string[]>;
}

export interface AdminEntitlementPlan {
  id: string;
  code: string;
  name: string;
  price_uzs: number | null;
  price_yearly_uzs: number | null;
  max_staff: number | null;
  max_devices: number | null;
  max_patients: number | null;
  is_active: boolean;
  is_public: boolean;
  sort_order: number;
  description: string | null;
  highlights: string[];
  entitlements: EntitlementsData;
  clinics: { total: number; active: number };
  updated_at?: string;
}

export interface AdminPlanUpdate {
  name?: string;
  price_uzs?: number;
  price_yearly_uzs?: number;
  max_staff?: number | null;
  max_devices?: number | null;
  max_patients?: number | null;
  is_active?: boolean;
  is_public?: boolean;
  sort_order?: number;
  description?: string | null;
  highlights?: string[];
  entitlements?: EntitlementsPatch;
}

export interface ClinicEntitlementOverride {
  clinic_id: string;
  overrides: EntitlementsPatch;
  custom_price_uzs: number | null;
  custom_price_yearly_uzs: number | null;
  discount_percent: number | null;
  note: string | null;
  valid_until: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface ClinicOverrideInput {
  overrides: EntitlementsPatch;
  custom_price_uzs?: number | null;
  custom_price_yearly_uzs?: number | null;
  discount_percent?: number | null;
  note?: string | null;
  valid_until?: string | null;
}

export interface EntitlementChange {
  id: number;
  scope?: 'plan' | 'clinic';
  plan_code?: string | null;
  clinic_id?: string | null;
  action: string;
  actor_id: string | null;
  actor_name?: string | null;
  before: unknown;
  after: unknown;
  created_at: string;
}

export interface AdminClinicEntitlements {
  clinic: {
    id: string;
    name: string;
    current_plan: string;
    subscription_status: string;
    subscription_ends_at: string | null;
    trial_ends_at: string | null;
    is_hq: boolean | null;
    company_id: string | null;
    organization_type: string;
  };
  plan: (Omit<AdminEntitlementPlan, 'clinics'> & { entitlements: EntitlementsData }) | null;
  override: ClinicEntitlementOverride | null;
  effective: EntitlementsData;
  usage: { staff: number; devices: number; patients: number };
  history: EntitlementChange[];
}

export interface ClinicDevice {
  id: string;
  user_id: string;
  user_name: string | null;
  user_role: string | null;
  kind: string;
  client: DeviceClientKind | null;
  fingerprint: string;
  name: string;
  os: string | null;
  browser: string | null;
  app_version: string | null;
  last_ip: string | null;
  last_used_at: string;
  is_trusted: boolean;
  is_revoked: boolean;
  revoked_at: string | null;
  created_at: string;
}

export interface AdminClinicStaff {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  custom_role_id: string | null;
  is_active: boolean;
  last_sign_in_at: string | null;
  created_at: string;
}

export interface AdminClinicCustomRole {
  id: string;
  name: string;
  description: string | null;
  base_role: string;
  permissions: Record<string, boolean>;
  is_archived: boolean;
  assigned: number;
  created_at: string;
  updated_at: string;
}

export interface AdminClinicRoles {
  staff: AdminClinicStaff[];
  custom_roles: AdminClinicCustomRole[];
  permission_modules: Record<string, readonly string[]>;
  role_defaults: Record<string, string[]>;
}

export interface PublicPlansResponse {
  groups: Array<{ key: string; label: string }>;
  modules: Array<{ key: string; label: string; description: string; group: string }>;
  plans: Array<{
    code: string;
    name: string;
    price_uzs: number | null;
    price_yearly_uzs: number | null;
    description: string | null;
    highlights: string[];
    limits: EntitlementsData['limits'];
    modules: string[];
    payments: EntitlementsData['payments'];
    journal: EntitlementsData['journal'];
    roles: EntitlementsData['roles'];
    devices: EntitlementsData['devices'];
  }>;
}
