// =============================================================================
// Dorixona 2.0 — API turlari (POS, prixod, kassa, dorixona kirishi, fiskal)
// =============================================================================

export type PharmacyUnitKind = 'unit' | 'blister' | 'pack';

/** Sotuv oynasining tezkor tugmasi (barcha kassalarda bir xil). */
export type PharmacyQuickButtonColor = 'emerald' | 'sky' | 'violet' | 'amber' | 'rose' | 'slate';

export interface PharmacyQuickButton {
  medication_id: string;
  /** Tugmadagi qisqa nom (bo'sh — dori nomi). */
  label?: string | null;
  color: PharmacyQuickButtonColor;
  /** Bo'sh — dorining standart birligi. */
  unit_kind?: PharmacyUnitKind | null;
  qty: number;
}

export interface PharmacyQuickButtons {
  buttons: PharmacyQuickButton[];
  /** true — bosilganda darhol savatga; false — miqdor oynasi ochiladi. */
  instant: boolean;
}

/** POS katalogidagi dori (tannarxsiz). */
export interface PharmacyCatalogItem {
  medication_id: string;
  name: string;
  form: string | null;
  strength: string | null;
  manufacturer: string | null;
  generic_name: string | null;
  price_uzs: number;
  qty_in_stock: number;
  qty_sellable: number;
  reorder_level: number | null;
  barcode: string | null;
  barcodes: string[];
  pack_qty: number;
  blister_qty: number | null;
  unit_name: string | null;
  pack_price_uzs: number | null;
  blister_price_uzs: number | null;
  sell_by_unit: boolean;
  requires_prescription: boolean | null;
  earliest_sellable_expiry: string | null;
  earliest_expiry: string | null;
  search_text: string | null;
  mxik_code: string | null;
  vat_percent: number | null;
}

export interface PharmacyParsedScan {
  raw: string;
  code: string;
  kind: 'gs1' | 'gtin' | 'url' | 'clary-sale' | 'text';
  gtin?: string;
  expiry?: string;
  batch?: string;
  serial?: string;
  prodDate?: string;
  ambiguous?: boolean;
  saleId?: string;
  url?: string;
}

export interface PharmacyLookupResult {
  parsed: PharmacyParsedScan;
  medication: Omit<PharmacyCatalogItem, 'barcodes' | 'search_text' | 'earliest_expiry'> | null;
}

export interface PharmacyFiscalSummary {
  id: string;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  is_test: boolean;
  fiscal_sign: string | null;
  fiscal_number: string | null;
  terminal_id: string | null;
  qr_url: string | null;
  last_error: string | null;
}

export interface PharmacySaleItem {
  id: string;
  medication_id: string;
  batch_id: string | null;
  name_snapshot: string;
  price_snapshot: number;
  quantity: number;
  returned_qty: number;
  subtotal_uzs: number;
  unit_kind: PharmacyUnitKind | null;
  unit_factor: number | null;
  unit_price_uzs: number | null;
  unit_qty: number | null;
}

export interface PharmacySaleDetail {
  id: string;
  total_uzs: number;
  paid_uzs: number;
  debt_uzs: number;
  discount_uzs: number;
  is_void: boolean;
  created_at: string;
  payment_method: string;
  notes: string | null;
  pharmacy_clinic_id: string | null;
  pharmacy_doctor_id: string | null;
  clinic_name: string | null;
  doctor_name: string | null;
  cashier_name: string | null;
  register_no: number | null;
  received_cash_uzs: number | null;
  change_uzs: number | null;
  fiscal_status: string | null;
  patient: { id: string; full_name: string; phone: string | null } | null;
  items: PharmacySaleItem[];
  payments: Array<{ method: string; amount_uzs: number }>;
  fiscal_receipts: Array<
    PharmacyFiscalSummary & { kind: string; ref_key: string; created_at: string }
  >;
  duplicate?: boolean;
  fiscal?: PharmacyFiscalSummary | null;
}

export interface PharmacySaleBody {
  idempotency_key?: string;
  patient_id?: string;
  reception_transaction_id?: string;
  pharmacy_clinic_id?: string;
  pharmacy_doctor_id?: string;
  prescription_id?: string;
  items: Array<{
    medication_id: string;
    quantity: number;
    unit_kind?: PharmacyUnitKind;
    unit_price_override_uzs?: number;
    preferred_batch_no?: string;
  }>;
  payment_method: string;
  payments?: Array<{ method: string; amount_uzs: number }>;
  paid_uzs?: number;
  debt_uzs?: number;
  discount_uzs?: number;
  received_cash_uzs?: number;
  change_uzs?: number;
  notes?: string;
  shift_id?: string;
  register_no?: number;
}

export interface PharmacyReceiptItemBody {
  medication_id: string;
  quantity: number;
  unit_kind?: 'unit' | 'pack';
  unit_cost_uzs: number;
  profit_percent?: number;
  doctor_share_percent?: number;
  doctor_share_bonus_uzs?: number;
  manufacturer?: string;
  manufacture_date?: string;
  batch_no?: string;
  expiry_date?: string;
  unit_price_uzs?: number;
  sale_price_uzs?: number;
  pack_price_uzs?: number;
  keep_higher_price?: boolean;
  gtin?: string;
  mxik_code?: string;
  source_name?: string;
}

export interface PharmacyReceiptBody {
  idempotency_key?: string;
  supplier_id?: string;
  receipt_no?: string;
  invoice_date?: string;
  received_at?: string;
  paid_uzs?: number;
  payment_method?: string;
  notes?: string;
  source?: 'manual' | 'excel' | 'scan' | 'po' | 'opening';
  file_name?: string;
  file_hash?: string;
  expected_total_uzs?: number;
  items: PharmacyReceiptItemBody[];
}

export interface PharmacyImportMatch {
  idx: number;
  medication_id: string | null;
  method: 'barcode' | 'alias' | 'mxik' | 'name' | null;
  score: number | null;
  last: {
    qty: number;
    unit_cost_uzs: number;
    entered_qty: number | null;
    unit_kind: string | null;
    at: string;
  } | null;
  candidates: Array<{
    id: string;
    name: string;
    strength: string | null;
    manufacturer: string | null;
    pack_qty: number;
    price_uzs: number;
    score: number;
  }>;
}

export interface PharmacyShift {
  id: string;
  clinic_id: string;
  register_no: number;
  opened_at: string;
  opening_cash_uzs: number;
  closed_at: string | null;
  expected_cash_uzs: number | null;
  actual_cash_uzs: number | null;
  diff_uzs: number | null;
  totals: PharmacyShiftTotals | null;
  notes: string | null;
  z_no: number | null;
  opened_by_operator: string | null;
  closed_by_operator: string | null;
  opened_by_name?: string | null;
  closed_by_name?: string | null;
}

export interface PharmacyShiftTotals {
  shift_id: string;
  register_no: number;
  opened_at: string;
  closed_at: string | null;
  opening_cash_uzs: number;
  sales_count: number;
  void_count: number;
  gross_uzs: number;
  discount_uzs: number;
  paid_uzs: number;
  debt_uzs: number;
  by_method: Record<string, number>;
  movements: Record<string, number>;
  refunds_uzs: number;
  returns_count: number;
  cash_sales_uzs: number;
  cash_movements_uzs: number;
  expected_cash_uzs: number;
  z_no?: number;
  actual_cash_uzs?: number;
  diff_uzs?: number;
}

export interface PharmacyOperator {
  id: string;
  full_name: string;
  role: 'admin' | 'cashier';
  register_no: number | null;
  can_return: boolean;
  can_receive: boolean;
  can_discount: boolean;
  is_active: boolean;
  sort_order: number;
  pin_locked_until: string | null;
  created_at: string;
}

export interface PharmacyDevice {
  id: string;
  name: string;
  register_no: number | null;
  user_agent: string | null;
  last_ip: string | null;
  last_seen_at: string;
  is_revoked: boolean;
  revoked_at: string | null;
  created_at: string;
}

export interface PharmacySubscriptionInfo {
  exists: boolean;
  active: boolean;
  status: string | null;
  ends_at: string | null;
  starts_at?: string;
  days_left: number;
  max_devices: number;
  price_uzs?: number;
  account_email?: string | null;
}

export interface PharmacyWorkspaceStatus {
  is_pharmacy_account: boolean;
  clinic: { id: string; name: string; logo_url: string | null } | null;
  account?: { email: string | null };
  subscription: PharmacySubscriptionInfo;
  device?: {
    registered: boolean;
    revoked: boolean;
    id: string | null;
    name: string | null;
    register_no: number | null;
  };
  devices_used?: number;
  operators_count?: number;
  has_admin?: boolean;
  operator?: {
    id: string;
    full_name: string;
    role: 'admin' | 'cashier';
    register_no: number | null;
    can_return: boolean;
    can_receive: boolean;
    can_discount: boolean;
  } | null;
}

export interface PharmacyFiscalSettings {
  enabled: boolean;
  provider: 'test' | 'http';
  company_tin: string | null;
  company_name: string | null;
  terminal_id: string | null;
  endpoint_url: string | null;
  has_secret: boolean;
  auto_send: boolean;
  block_without_mxik: boolean;
  default_vat_percent: number;
}

export interface AdminPharmacySubscription {
  id: string;
  clinic_id: string;
  status: 'active' | 'suspended' | 'canceled';
  price_uzs: number;
  max_devices: number;
  starts_at: string;
  ends_at: string;
  account_user_id: string | null;
  account_email: string | null;
  notes: string | null;
  active: boolean;
  days_left: number;
  clinic?: { id: string; name: string; slug: string; city: string | null } | null;
}
