// =============================================================================
// Filial tarmog'i (kompaniya = tarmoq, klinika = filial; 1 HQ + 10 tagacha)
// =============================================================================

export type NetworkMemberRole = 'company_owner' | 'company_admin' | 'branch_user';

export interface NetworkMyBranch {
  clinic_id: string;
  name: string;
  branch_code: string | null;
  is_hq: boolean;
  city: string | null;
  branch_color: string | null;
  company_id: string;
  member_role: NetworkMemberRole | null;
  is_home: boolean;
}

export interface NetworkAccess {
  active_clinic_id: string | null;
  branches: NetworkMyBranch[];
}

export interface NetworkCompany {
  id: string;
  name: string;
  package: string;
  base_currency: string;
  country: string;
  max_branches: number;
  billing_mode: 'per_branch' | 'company';
  shared_patients: boolean;
  branch_fee_uzs: number;
}

export interface NetworkBranch {
  id: string;
  name: string;
  branch_code: string | null;
  branch_color: string | null;
  is_hq: boolean;
  city: string | null;
  address: string | null;
  phone: string | null;
}

export interface NetworkMy {
  company: NetworkCompany | null;
  branches: NetworkBranch[];
  branch_count: number;
  active_clinic_id: string;
  viewer: {
    member_role: NetworkMemberRole | null;
    can_manage: boolean;
    is_owner: boolean;
    branch_ids: string[];
  } | null;
}

export interface NetworkLiveRow {
  clinic_id: string;
  name: string;
  is_hq: boolean;
  branch_code: string | null;
  branch_color: string | null;
  received_uzs: number;
  debt_uzs: number;
  pharmacy_uzs: number;
  queue_total: number;
  queue_waiting: number;
  queue_served: number;
  open_shifts: number;
  inpatients: number;
  new_patients: number;
  low_stock: number;
  expiring_30d: number;
  cash_uzs: number;
  safe_uzs: number;
  debtors_uzs: number;
}

export interface NetworkCompareRow {
  clinic_id: string;
  name: string;
  is_hq: boolean;
  received_uzs: number;
  refunds_uzs: number;
  debt_uzs: number;
  pharmacy_uzs: number;
  expenses_uzs: number;
  payroll_uzs: number;
  visits: number;
  unique_patients: number;
  new_patients: number;
}

export interface NetworkConsolidated {
  from: string;
  to: string;
  branches: Array<{
    clinic_id: string;
    clinic_name: string;
    income: number;
    expense: number;
    profit: number;
  }>;
  consolidated: { income: number; expense: number; profit: number };
}

export interface NetworkStaffRow {
  /** HR anketa (staff_profiles) id — ko'chirish uchun; faqat login bo'lsa null */
  staff_id: string | null;
  key: string;
  clinic_id: string;
  clinic_name: string;
  full_name: string;
  position: string | null;
  specialization: string | null;
  phone: string | null;
  email: string | null;
  role: string | null;
  has_login: boolean;
  last_sign_in_at: string | null;
  is_active: boolean;
}

export interface NetworkMember {
  id: string;
  role: NetworkMemberRole;
  accessible_clinic_ids: string[];
  created_at: string;
  user: {
    id: string;
    full_name: string;
    email: string;
    role: string;
    clinic_id: string | null;
  } | null;
}

export interface NetworkAuditRow {
  id: string;
  clinic_id: string | null;
  actor_id: string | null;
  action: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export type NetworkCatalogKind = 'services' | 'lab' | 'diagnostics';

export interface NetworkCatalogPushResult {
  source_clinic_id: string;
  result: Record<
    string,
    Partial<Record<NetworkCatalogKind, { inserted: number; updated: number; archived: number }>>
  >;
}

export type NetworkTransferStatus = 'in_transit' | 'received' | 'canceled';

interface NetworkTransferBase {
  id: string;
  company_id: string;
  from_clinic_id: string;
  to_clinic_id: string;
  status: NetworkTransferStatus;
  notes: string | null;
  sent_by: string | null;
  sent_at: string;
  received_by: string | null;
  received_at: string | null;
  canceled_by: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  from_clinic: { id: string; name: string } | null;
  to_clinic: { id: string; name: string } | null;
}

export interface NetworkStockTransfer extends NetworkTransferBase {
  total_cost_uzs: number;
  items_count: number;
  receipt_id: string | null;
}

export interface NetworkStockTransferItem {
  id: string;
  name: string;
  strength: string | null;
  form: string | null;
  batch_no: string | null;
  expiry_date: string | null;
  quantity: number;
  unit_cost_uzs: number;
  unit_price_uzs: number | null;
  target_medication_id: string | null;
}

export interface NetworkCashTransfer extends NetworkTransferBase {
  amount_uzs: number;
  register: 'reception' | 'inpatient';
}

export interface NetworkReferral {
  id: string;
  clinic_id: string;
  source_clinic_id: string | null;
  status: string;
  urgency: string;
  referral_kind: string;
  notes: string | null;
  clinical_indication: string | null;
  created_at: string;
  patient: { id: string; full_name: string; phone: string | null } | null;
  doctor: { id: string; full_name: string } | null;
  service: { id: string; name_i18n: Record<string, string>; price_uzs: number } | null;
}

export interface NetworkDuplicateGroup {
  dup_key: string;
  items: Array<{
    id: string;
    clinic_id: string;
    clinic_name: string;
    full_name: string;
    phone: string | null;
    dob: string | null;
    created_at: string;
    visits: number;
  }>;
}

// ── Super-admin ──────────────────────────────────────────────────────────────
export interface AdminNetworkListItem {
  id: string;
  name: string;
  package: string;
  max_branches: number;
  billing_mode: 'per_branch' | 'company';
  branch_fee_uzs: number;
  shared_patients: boolean;
  created_at: string;
  branch_count: number;
  is_network: boolean;
  hq: { id: string; name: string; slug: string; plan: string; status: string } | null;
  branches: Array<{ id: string; name: string; is_hq: boolean; city: string | null }>;
}

export interface AdminNetworkBranch {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  is_hq: boolean;
  branch_code: string | null;
  branch_color: string | null;
  current_plan: string;
  subscription_status: string;
  trial_ends_at: string | null;
  created_at: string;
  patients: number;
  staff: number;
}

export type AdminNetworkBilling =
  | {
      mode: 'company';
      hq_plan: string | null;
      hq_price_uzs: number;
      branch_fee_uzs: number;
      branches: number;
      monthly_total_uzs: number;
    }
  | {
      mode: 'per_branch';
      lines: Array<{ clinic_id: string; plan: string; price_uzs: number }>;
      monthly_total_uzs: number;
    };

export interface AdminNetworkDetail {
  company: {
    id: string;
    name: string;
    legal_name: string | null;
    package: string;
    max_branches: number;
    billing_mode: 'per_branch' | 'company';
    branch_fee_uzs: number;
    shared_patients: boolean;
    created_at: string;
  };
  branches: AdminNetworkBranch[];
  branch_ids: string[];
  members: NetworkMember[];
  audit: NetworkAuditRow[];
  billing: AdminNetworkBilling;
}

export interface AdminNetworkCandidate {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  company_id: string | null;
  current_plan: string;
  subscription_status: string;
  own_network_size: number;
}

export interface AdminNetworkPreview {
  company: { id: string; name: string; max_branches: number; branches: number };
  clinic: {
    id: string;
    name: string;
    current_company_id: string | null;
    plan: string;
    subscription_status: string;
  };
  patients: number;
  staff: number;
  open_shifts: number;
  possible_duplicates: number;
  blockers: Array<'archived' | 'already_linked' | 'has_own_branches' | 'limit'>;
}

export interface AdminNetworkConfigure {
  name?: string;
  max_branches?: number;
  billing_mode?: 'per_branch' | 'company';
  branch_fee_uzs?: number;
  package?: 'small' | 'business' | 'enterprise';
  shared_patients?: boolean;
}

export interface AdminNetworkNewBranch {
  name: string;
  slug: string;
  city?: string;
  branch_code?: string;
  copy_catalog?: boolean;
  copy_settings?: boolean;
  manager_email?: string;
  manager_full_name?: string;
}
