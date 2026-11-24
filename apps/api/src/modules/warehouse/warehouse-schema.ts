export const WAREHOUSE_SCHEMA_VERSION = '1.0.0';

/**
 * Initial data-plane schema for a single CLARY Sklad tenant.
 * This SQL is executed only against the newly provisioned warehouse database,
 * never against the existing CLARY Clinic/Supabase database.
 */
export const WAREHOUSE_INITIAL_SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS warehouse_schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS warehouse_meta (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    tenant_id UUID NOT NULL,
    schema_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS warehouse_users (
    user_id UUID PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('warehouse_owner', 'warehouse_admin', 'warehouse_manager', 'warehouse_operator', 'warehouse_viewer')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    address TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS product_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID REFERENCES product_categories(id),
    name TEXT NOT NULL,
    code TEXT UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES product_categories(id),
    sku TEXT NOT NULL UNIQUE,
    barcode TEXT UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    base_unit TEXT NOT NULL DEFAULT 'pcs',
    purchase_price NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
    sale_price NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS stock_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    product_id UUID NOT NULL REFERENCES products(id),
    movement_type TEXT NOT NULL CHECK (movement_type IN ('opening', 'receipt', 'issue', 'transfer_in', 'transfer_out', 'adjustment', 'return_in', 'return_out')),
    quantity NUMERIC(18, 3) NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    reference_type TEXT,
    reference_id UUID,
    note TEXT,
    created_by UUID,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stock_ledger_product_warehouse_date
    ON stock_ledger(product_id, warehouse_id, occurred_at DESC)`,
  `CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    tax_id TEXT,
    phone TEXT,
    email TEXT,
    credit_limit NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    tax_id TEXT,
    phone TEXT,
    email TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number TEXT NOT NULL UNIQUE,
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'partially_received', 'received', 'cancelled')),
    currency CHAR(3) NOT NULL DEFAULT 'UZS',
    total_amount NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity NUMERIC(18, 3) NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC(18, 2) NOT NULL CHECK (unit_cost >= 0),
    received_quantity NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0)
  )`,
  `CREATE TABLE IF NOT EXISTS sales_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number TEXT NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'picking', 'packed', 'dispatched', 'completed', 'cancelled')),
    currency CHAR(3) NOT NULL DEFAULT 'UZS',
    total_amount NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sales_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity NUMERIC(18, 3) NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(18, 2) NOT NULL CHECK (unit_price >= 0)
  )`,
  `CREATE TABLE IF NOT EXISTS warehouse_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    before_data JSONB,
    after_data JSONB,
    request_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_warehouse_audit_created_at
    ON warehouse_audit_events(created_at DESC)`,
];
