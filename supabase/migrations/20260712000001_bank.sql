-- =============================================================================
-- QISM 2 / E4 — Bank Integration: bank hisoblari + statement (vyderjka) +
-- reconciliation (GL kassa bilan solishtirish). amount_uzs signed: +kirim / −chiqim.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name text NOT NULL,
  bank_name text,
  account_number text,
  currency text NOT NULL DEFAULT 'UZS',
  gl_code text NOT NULL DEFAULT '1030',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_clinic ON public.bank_accounts (clinic_id) WHERE is_active = true;

DROP TRIGGER IF EXISTS tg_bank_accounts_updated ON public.bank_accounts;
CREATE TRIGGER tg_bank_accounts_updated BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  txn_date date NOT NULL,
  amount_uzs bigint NOT NULL,           -- +kirim / −chiqim
  description text,
  external_ref text,
  matched_journal_id uuid REFERENCES public.gl_journals(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','matched','ignored')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_txn_account ON public.bank_transactions (bank_account_id, txn_date DESC);

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.bank_accounts, public.bank_transactions FROM anon, authenticated;
