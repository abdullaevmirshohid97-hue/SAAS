-- =============================================================================
-- DAVLAT DORI KATALOGI (MXIK) + REESTR — funksional tekshiruv (prod'da XAVFSIZ)
-- =============================================================================
-- 20261006000001 / 20261006000002 qo'llangandan keyin. Test katalog yozuvlari
-- (MXIK 99999…) → qidiruv (1 harf / so'z / shtrix-kod) → klinikaga qo'shish →
-- shtrix-kod o'rganish → reestr importi va moslash zanjirini o'tadi va OXIRIDA
-- ATAYLAB  RAISE EXCEPTION 'TEST_RESULT ...'  qiladi — hammasi bekor bo'ladi.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -f scripts/verify-drug-reference.sql
-- =============================================================================
BEGIN;
DO $test$
DECLARE
  c uuid;
  u uuid;
  r jsonb;
  r2 jsonb;
  med uuid;
  n int;
  imp uuid := gen_random_uuid();
  lg text := '';
  bad text := '';
BEGIN
  SELECT p.clinic_id, p.id INTO c, u
    FROM profiles p JOIN clinics cl ON cl.id = p.clinic_id
   WHERE cl.deleted_at IS NULL AND p.role IN ('clinic_owner', 'clinic_admin')
   ORDER BY p.created_at
   LIMIT 1;
  IF c IS NULL THEN
    RAISE EXCEPTION 'TEST_SETUP_FAILED: faol klinika topilmadi';
  END IF;

  -- 1) Sinxron: 2 ta test yozuv (+ bitta shtrix-kod), takror chaqiriq yangilaydi
  n := drug_reference_upsert(jsonb_build_array(
    jsonb_build_object('mxik_code', '99999000000000001', 'kind', 'drug', 'name', 'ЗЗТЕСТИН',
      'manufacturer', 'Clary Test Pharm', 'strength', '500 мг', 'form', 'Таблетки блистеры',
      'pack_qty', 20, 'blister_qty', 10, 'unit_name', 'tabletka', 'generic_name', 'testin',
      'atc_code', 'N02BE01', 'class_code', '99999', 'vat_exempt', true,
      'gtins', jsonb_build_array('04006381333931')),
    jsonb_build_object('mxik_code', '99999000000000002', 'kind', 'device', 'name', 'ЗЗТЕСТ тонометр',
      'class_code', '99999', 'pack_qty', 1, 'gtins', '[]'::jsonb)), 'mxik');
  lg := lg || 'upsert=' || n || ';';
  IF n <> 2 THEN bad := bad || 'upsert;'; END IF;
  -- Jonli so'rov (shtrix-kod bo'yicha) ommaviy sinxron yozuvini "live" ga tushirmaydi
  n := drug_reference_upsert(jsonb_build_array(
    jsonb_build_object('mxik_code', '99999000000000001', 'kind', 'drug', 'name', 'ЗЗТЕСТИН',
      'manufacturer', 'Clary Test Pharm', 'strength', '500 мг', 'form', 'Таблетки блистеры',
      'pack_qty', 20, 'blister_qty', 10, 'unit_name', 'tabletka', 'generic_name', 'testin',
      'atc_code', 'N02BE01', 'class_code', '99999', 'vat_exempt', true,
      'gtins', jsonb_build_array('04006381333931'))), 'live');
  IF (SELECT source FROM drug_reference WHERE mxik_code = '99999000000000001') <> 'mxik' THEN
    bad := bad || 'live_downgrade;';
  END IF;

  -- 2) Qidiruv
  n := (SELECT count(*) FROM drug_reference_search('ззт', 10, NULL) WHERE mxik_code LIKE '99999%');
  lg := lg || 'q3=' || n || ';';
  IF n < 1 THEN bad := bad || 'search3;'; END IF;
  n := (SELECT count(*) FROM drug_reference_search('zztestin 500', 10, NULL) WHERE mxik_code = '99999000000000001');
  lg := lg || 'qlat=' || n || ';';
  IF n <> 1 THEN bad := bad || 'search_latin;'; END IF;
  n := (SELECT count(*) FROM drug_reference_search('4006381333931', 10, NULL) WHERE mxik_code = '99999000000000001');
  lg := lg || 'qbc=' || n || ';';
  IF n <> 1 THEN bad := bad || 'search_barcode;'; END IF;
  n := (SELECT count(*) FROM drug_reference_search('zztest', 10, 'device'));
  IF n <> 1 THEN bad := bad || 'search_kind;'; END IF;
  lg := lg || 'q1=' || (SELECT count(*) FROM drug_reference_search('п', 5, NULL)) || ';';

  -- 3) Klinikaga qo'shish: birinchi marta yaratadi, keyin o'sha dorini qaytaradi
  r := pharmacy_adopt_reference(c, u, '99999000000000001', '4006381333931', true, '1234567');
  med := (r->>'medication_id')::uuid;
  lg := lg || 'adopt=' || (r->>'created') || ';';
  IF (r->>'created')::boolean IS DISTINCT FROM true THEN bad := bad || 'adopt_create;'; END IF;
  IF NOT EXISTS (SELECT 1 FROM medications WHERE id = med AND clinic_id = c
                  AND mxik_code = '99999000000000001' AND pack_qty = 20 AND blister_qty = 10
                  AND sell_by_unit AND package_code = '1234567' AND vat_percent = 0
                  AND manufacturer = 'Clary Test Pharm') THEN
    bad := bad || 'adopt_fields;';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM medication_barcodes WHERE medication_id = med AND code = '04006381333931') THEN
    bad := bad || 'adopt_barcode;';
  END IF;
  r2 := pharmacy_adopt_reference(c, u, '99999000000000001', NULL);
  IF (r2->>'medication_id')::uuid <> med OR (r2->>'created')::boolean THEN bad := bad || 'adopt_dup;'; END IF;

  -- 4) Dorixona o'rgatgan kod (ichki "02…" kod o'rganilmaydi)
  INSERT INTO medication_barcodes (clinic_id, medication_id, code, kind)
  VALUES (c, med, '04600000000008', 'manufacturer'), (c, med, '02000000000008', 'manufacturer')
  ON CONFLICT (clinic_id, code) DO NOTHING;
  n := (SELECT count(*) FROM drug_reference_barcodes WHERE mxik_code = '99999000000000001' AND source = 'clinic');
  lg := lg || 'learn=' || n || ';';
  IF n < 1 THEN bad := bad || 'learn;'; END IF;
  IF EXISTS (SELECT 1 FROM drug_reference_barcodes WHERE code = '02000000000008') THEN
    bad := bad || 'learn_internal;';
  END IF;
  PERFORM drug_reference_learn_backfill();

  -- 5) Reestr: import → moslash → yakun
  n := drug_registry_import_rows(imp, jsonb_build_array(
    jsonb_build_object('reg_number', 'TEST/0001', 'trade_name', 'ЗЗТЕСТИН Таблетки 500 мг №20(2x10)',
      'manufacturer', 'ООО Clary Test Pharm Узбекистан', 'atc_code', 'N02BE01',
      'is_active', 'false', 'rx_required', 'true', 'valid_until', '2020-01-01'),
    jsonb_build_object('reg_number', 'TEST/0002', 'trade_name', '')));
  lg := lg || 'reg_rows=' || n || ';';
  IF n <> 1 THEN bad := bad || 'reg_import;'; END IF;
  PERFORM drug_registry_reset_matches();
  n := drug_registry_match(imp, '99999');
  lg := lg || 'reg_match=' || n || ';';
  IF NOT EXISTS (SELECT 1 FROM drug_reference WHERE mxik_code = '99999000000000001'
                  AND reg_number = 'TEST/0001' AND reg_active = false AND rx_required) THEN
    bad := bad || 'reg_match;';
  END IF;
  r := drug_registry_finish(imp);
  lg := lg || 'reg_finish=' || (r->>'rows') || ';';

  -- 6) Nofaol qilish va statistika
  n := drug_reference_deactivate_stale(now() + interval '1 minute', ARRAY['99999']);
  lg := lg || 'stale=' || n || ';';
  IF n <> 2 THEN bad := bad || 'stale;'; END IF;
  IF EXISTS (SELECT 1 FROM drug_reference_search('zztestin', 10, NULL) WHERE mxik_code LIKE '99999%') THEN
    bad := bad || 'search_inactive;';
  END IF;
  r := drug_reference_stats();
  lg := lg || 'stats_total=' || (r->>'total') || ';';

  RAISE EXCEPTION 'TEST_RESULT % | %', CASE WHEN bad = '' THEN 'OK' ELSE 'FAIL[' || bad || ']' END, lg;
END
$test$;
ROLLBACK;
