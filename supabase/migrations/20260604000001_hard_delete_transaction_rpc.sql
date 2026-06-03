-- Tranzaksiyani xavfsiz hard-delete qiluvchi RPC.
-- patient_ledger append-only (no_delete/no_update RULE) — to'g'ridan DELETE ishlamaydi
-- va FK (NO ACTION) tx o'chirishni bloklaydi. Bu funksiya rule'ni vaqtincha
-- o'chirib, ledger yozuvlarini o'chiradi, boshqa NO ACTION FK'larni uzadi,
-- so'ng tranzaksiyani o'chiradi (transaction_items + doctor_commissions CASCADE).
CREATE OR REPLACE FUNCTION public.hard_delete_transaction(p_clinic_id uuid, p_tx uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transactions WHERE id = p_tx AND clinic_id = p_clinic_id) THEN
    RAISE EXCEPTION 'Tranzaksiya topilmadi yoki ruxsat yo''q';
  END IF;

  ALTER TABLE patient_ledger DISABLE RULE no_delete_patient_ledger;
  BEGIN
    DELETE FROM patient_ledger WHERE transaction_id = p_tx AND clinic_id = p_clinic_id;
    UPDATE payment_qr_invoices SET transaction_id = NULL WHERE transaction_id = p_tx;
    UPDATE home_nurse_visits SET transaction_id = NULL WHERE transaction_id = p_tx;
    UPDATE service_referrals SET fulfilled_transaction_id = NULL WHERE fulfilled_transaction_id = p_tx;
    DELETE FROM transactions WHERE id = p_tx AND clinic_id = p_clinic_id;
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE patient_ledger ENABLE RULE no_delete_patient_ledger;
    RAISE;
  END;
  ALTER TABLE patient_ledger ENABLE RULE no_delete_patient_ledger;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hard_delete_transaction(uuid, uuid) TO service_role, authenticated;
