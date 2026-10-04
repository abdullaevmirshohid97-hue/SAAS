-- =============================================================================
-- DORIXONA 2.0 — funksional tekshiruv (prod'da XAVFSIZ: hech narsa saqlanmaydi)
-- =============================================================================
-- Migratsiyalar qo'llangandan keyin ishga tushiriladi. Blok test dorilarini
-- yaratadi, prixod → sotuv (qadoq/dona, aralash to'lov) → qaytarish → smena Z →
-- bekor qilish → qadoq hajmi → prixod bekor qilish zanjirini o'tadi va OXIRIDA
-- ATAYLAB  RAISE EXCEPTION 'TEST_RESULT ...'  qiladi — tranzaksiya to'liq
-- bekor bo'ladi (test yozuvlari bazada qolmaydi).
--
-- Natija: xato matni 'TEST_RESULT' bilan boshlansa — zanjir oxirigacha o'tdi.
-- Boshqa xato chiqsa — o'sha funksiyada muammo bor (deploy to'xtatiladi).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -f scripts/verify-pharmacy-v2.sql
-- =============================================================================
BEGIN;
DO $test$
DECLARE
  c uuid;
  u uuid;
  m1 uuid; m2 uuid; r jsonb; r2 jsonb; s jsonb; sh uuid; lg text := '';
  v_sale uuid; v_item uuid; t jsonb; k uuid := gen_random_uuid(); sk uuid := gen_random_uuid();
  n1 int; n2 int; sumi bigint; bad text := '';
BEGIN
  -- Istalgan faol klinika va uning egasi/admini (hamma o'zgarish oxirida bekor qilinadi)
  SELECT p.clinic_id, p.id INTO c, u
    FROM profiles p JOIN clinics cl ON cl.id = p.clinic_id
   WHERE cl.deleted_at IS NULL AND p.role IN ('clinic_owner', 'clinic_admin')
   ORDER BY p.created_at
   LIMIT 1;
  IF c IS NULL THEN
    RAISE EXCEPTION 'TEST_SETUP_FAILED: faol klinika topilmadi';
  END IF;

  lg := lg || 'norm1=' || clary_search_norm('Амоксициллин 500мг №20') || ';';
  lg := lg || 'norm2=' || clary_search_norm('Amoxicillin 500 mg N20') || ';';
  lg := lg || 'norm3=' || clary_search_norm('Кўк чой') || ';';
  lg := lg || 'bc=' || clary_barcode_norm(' 4006381333931 ') || ',' || clary_barcode_norm('ab-12') || ';';

  INSERT INTO medications (clinic_id, name, strength, price_uzs, created_by) VALUES (c, 'TEST Paratsetamol', '500mg', 1800, u) RETURNING id INTO m1;
  INSERT INTO medications (clinic_id, name, strength, price_uzs, created_by, pack_qty, blister_qty, sell_by_unit)
    VALUES (c, 'TEST Seftriakson', '1g', 1000, u, 20, 10, true) RETURNING id INTO m2;
  SELECT search_text INTO r2 FROM (SELECT to_jsonb(search_text) search_text FROM medications WHERE id = m1) x;
  lg := lg || 'st=' || (r2#>>'{}') || ';';

  r := pharmacy_receive(c, u, jsonb_build_object('idempotency_key', k, 'source', 'excel', 'items', jsonb_build_array(
        jsonb_build_object('medication_id', m1, 'unit_kind', 'unit', 'entered_qty', 10, 'entered_cost_uzs', 1500, 'sale_price_uzs', 2000,
                           'expiry_date', (current_date + 400)::text, 'batch_no', 'B1', 'gtin', '4006381333931', 'source_name', 'Paracetamol 500 tab'),
        jsonb_build_object('medication_id', m2, 'unit_kind', 'pack', 'entered_qty', 5, 'entered_cost_uzs', 20000, 'pack_price_uzs', 26000,
                           'expiry_date', (current_date + 500)::text, 'batch_no', 'S7'))));
  lg := lg || 'recv=' || (r->>'total_cost_uzs') || '/' || (r->>'duplicate') || ';';
  IF (r->>'total_cost_uzs')::bigint <> 115000 THEN bad := bad || 'recv_total;'; END IF;
  r2 := pharmacy_receive(c, u, jsonb_build_object('idempotency_key', k, 'items', jsonb_build_array(jsonb_build_object('medication_id', m1, 'entered_qty', 1))));
  lg := lg || 'dup=' || (r2->>'duplicate') || ';';
  IF (r2->>'duplicate')::boolean IS DISTINCT FROM true THEN bad := bad || 'recv_dup;'; END IF;
  SELECT stock INTO n1 FROM medications WHERE id = m1; SELECT stock INTO n2 FROM medications WHERE id = m2;
  lg := lg || 'stock=' || n1 || ',' || n2 || ';';
  IF n1 <> 10 OR n2 <> 100 THEN bad := bad || 'recv_stock;'; END IF;
  lg := lg || 'price=' || (SELECT price_uzs || '/' || coalesce(pack_price_uzs::text,'-') FROM medications WHERE id = m2) || ';';
  lg := lg || 'hist=' || (SELECT count(*) FROM medication_price_history WHERE receipt_id = (r->>'receipt_id')::uuid) || ';';
  lg := lg || 'bcode=' || (SELECT count(*) FROM medication_barcodes WHERE medication_id = m1) || ';';

  t := pharmacy_match_import(c, NULL, jsonb_build_array(
        jsonb_build_object('idx', 0, 'name', 'xyz', 'barcode', '4006381333931'),
        jsonb_build_object('idx', 1, 'name', 'Paracetamol 500 tab'),
        jsonb_build_object('idx', 2, 'name', 'TEST Seftriakson', 'strength', '1g'),
        jsonb_build_object('idx', 3, 'name', 'Seftriakson 1 g')));
  lg := lg || 'match=' || (t->0->>'method') || ',' || (t->1->>'method') || ',' || (t->2->>'method') || ',' || coalesce(t->3->>'method','-') || ':' || jsonb_array_length(t->3->'candidates') || ';';

  INSERT INTO pharmacy_shifts (clinic_id, register_no, opened_by_user, opening_cash_uzs) VALUES (c, 1, u, 100000) RETURNING id INTO sh;
  s := pharmacy_sell_v2(c, u, jsonb_build_object('idempotency_key', sk, 'pharmacy_shift_id', sh, 'require_shift', true, 'discount_uzs', 900,
        'items', jsonb_build_array(
           jsonb_build_object('medication_id', m1, 'quantity', 2, 'unit_kind', 'unit'),
           jsonb_build_object('medication_id', m2, 'quantity', 1, 'unit_kind', 'pack'),
           jsonb_build_object('medication_id', m2, 'quantity', 3, 'unit_kind', 'unit')),
        'payments', jsonb_build_array(jsonb_build_object('method','cash','amount_uzs',20000), jsonb_build_object('method','card','amount_uzs',13000))));
  v_sale := (s->>'sale_id')::uuid;
  lg := lg || 'sale=' || (s->>'subtotal_uzs') || '/' || (s->>'total_uzs') || '/' || (s->>'payment_method') || ';';
  IF (s->>'total_uzs')::bigint <> 33000 OR (s->>'payment_method') <> 'mixed' THEN bad := bad || 'sale_total;'; END IF;
  SELECT sum(subtotal_uzs) INTO sumi FROM pharmacy_sale_items WHERE sale_id = v_sale;
  lg := lg || 'itemsum=' || sumi || ';';
  IF sumi <> 33000 THEN bad := bad || 'sale_items_sum;'; END IF;
  SELECT stock INTO n1 FROM medications WHERE id = m1; SELECT stock INTO n2 FROM medications WHERE id = m2;
  lg := lg || 'stock2=' || n1 || ',' || n2 || ';';
  IF n1 <> 8 OR n2 <> 77 THEN bad := bad || 'sale_stock;'; END IF;
  r2 := pharmacy_sell_v2(c, u, jsonb_build_object('idempotency_key', sk, 'items', jsonb_build_array(jsonb_build_object('medication_id', m1, 'quantity', 1))));
  lg := lg || 'saledup=' || (r2->>'duplicate') || ';';
  IF (r2->>'duplicate')::boolean IS DISTINCT FROM true THEN bad := bad || 'sale_dup;'; END IF;

  SELECT id INTO v_item FROM pharmacy_sale_items WHERE sale_id = v_sale AND medication_id = m1 LIMIT 1;
  r2 := pharmacy_return_items_v2(c, u, v_sale, jsonb_build_array(jsonb_build_object('sale_item_id', v_item, 'qty', 1)), 'test', sh, NULL);
  lg := lg || 'ret=' || (r2->>'refund_uzs') || '/' || (r2->>'cash_back_uzs') || ';';

  t := pharmacy_shift_totals(c, sh);
  lg := lg || 'shift=' || (t->>'gross_uzs') || '/' || (t->>'paid_uzs') || '/' || (t->>'expected_cash_uzs') || '/' || (t->>'refunds_uzs') || ';';
  t := pharmacy_close_shift(c, sh, u, NULL, (t->>'expected_cash_uzs')::bigint, NULL);
  lg := lg || 'z=' || (t->>'z_no') || '/' || (t->>'diff_uzs') || ';';

  r2 := pharmacy_void_sale_v2(c, u, v_sale, 'test void', NULL, NULL);
  lg := lg || 'void=' || (r2->>'ok') || ';';
  SELECT stock INTO n1 FROM medications WHERE id = m1; SELECT stock INTO n2 FROM medications WHERE id = m2;
  lg := lg || 'stock3=' || n1 || ',' || n2 || ';';
  IF n1 <> 10 OR n2 <> 100 THEN bad := bad || 'void_stock;'; END IF;

  r2 := pharmacy_set_pack_size(c, u, m1, 10, true);
  SELECT stock INTO n1 FROM medications WHERE id = m1;
  lg := lg || 'conv=' || (r2->>'converted') || '/' || n1 || '/' || (SELECT price_uzs || ',' || pack_price_uzs FROM medications WHERE id = m1) || ';';
  IF n1 <> 100 THEN bad := bad || 'pack_convert;'; END IF;

  BEGIN
    PERFORM pharmacy_void_receipt(c, u, (r->>'receipt_id')::uuid, 'test');
    lg := lg || 'voidrec=ok;';
  EXCEPTION WHEN OTHERS THEN lg := lg || 'voidrec_err=' || SQLERRM || ';';
  END;
  lg := lg || 'search=' || (SELECT count(*) FROM pharmacy_search_medications(c, 'seftriakson', 10)) || ';';

  RAISE EXCEPTION 'TEST_RESULT % | %', CASE WHEN bad = '' THEN 'OK' ELSE 'FAIL[' || bad || ']' END, lg;
END
$test$;
ROLLBACK;
