-- =============================================================================
-- XAVFSIZLIK ADVISOR — FAQAT XAVFSIZ TUZATISHLAR
-- =============================================================================
-- Supabase advisor 85 ta WARN beradi. Ularning HAMMASINI "tuzatish" prod'ni
-- BUZADI. Quyida har bir sinf bo'yicha qaror va sabab yozilgan — keyingi safar
-- kimdir "advisor qizil, tuzataylik" deganda shu fayl javob beradi.
--
-- ── QILINADI (bu migratsiya) ────────────────────────────────────────────────
--   1. can_access_branch dan EXECUTE olib tashlash (TEKSHIRILDI: anon endi 401)
--   2. tg_set_updated_at va gl_cash_code ga search_path qadash
--   3. pgaudit_* — urinib ko'riladi, lekin AMALDA ISHLAMAYDI (pastga qarang)
--
-- ── ATAYLAB QILINMAYDI ──────────────────────────────────────────────────────
--   4. get_my_clinic_id / get_my_role / get_my_company_id — TEGILMAYDI.
--      TAJRIBA (2026-08-08, izolyatsiyalangan probe jadval + funksiya):
--        policy ichidagi funksiyaga EXECUTE bo'lmasa →
--        "ERROR: 42501 permission denied for function" va SO'ROV YIQILADI.
--      Bazada 417 policydan 353 tasi get_my_clinic_id(), 71 tasi get_my_role()
--      ishlatadi. EXECUTE olib tashlansa web-clinic "Sharhlar" va "Veb-profil"
--      sahifalari, bemor portali profili — hammasi ishlamay qoladi.
--      Xavf esa NOL: bu funksiyalar chaquruvchining O'Z clinic_id/role'ini
--      qaytaradi — foydalanuvchi buni allaqachon biladi.
--      ESLATMA: 20260703000001 migratsiyasi bularni "revoke" qilgan, lekin
--      PUBLIC'dagi standart grant qolgani uchun amalda ishlamagan. Yaxshiyamki —
--      aks holda o'shanda prod yiqilardi.
--
--   5. extension_in_public (pg_net, pg_trgm, moddatetime, pgaudit) — TEGILMAYDI.
--      Kengaytmani boshqa sxemaga ko'chirish unga bog'liq indekslarni
--      (pg_trgm — qidiruv indekslari) buzadi. Foyda yo'q, xavf katta.
--
--   6. clinic_rating_summary matview — TEGILMAYDI. U ataylab ochiq: klinika
--      veb-profil sahifasi (web-profile.tsx) uni to'g'ridan-to'g'ri o'qiydi.
--
--   7. rls_enabled_no_policy (58 jadval) — POLICY QO'SHILMAYDI.
--      Hozir: RLS yoqilgan + policy yo'q = HAMMAGA YOPIQ (service_role'dan
--      tashqari). API service_role bilan ishlaydi, ya'ni arxitekturaga mos.
--      Policy qo'shish bu jadvallarni (buxgalteriya, GL, inventar, sug'urta)
--      mijoz tomoniga OCHADI — bu yaxshilanish emas, REGRESSIYA bo'lardi.
--
--   8. auth_leaked_password_protection — SQL bilan yoqib bo'lmaydi.
--      Supabase Dashboard → Authentication → Policies → "Leaked password
--      protection" QO'LDA yoqilsin (HaveIBeenPwned tekshiruvi).
-- =============================================================================

-- --- 1) pgaudit event-trigger funksiyalari ---------------------------------
-- ⚠️ NATIJA: BU BLOK AMALDA HECH NARSA QILMAYDI — ataylab qoldirilgan.
-- Funksiyalar egasi `supabase_admin`, biz esa `postgres` sifatida ishlaymiz.
-- PostgreSQL'da ega bo'lmagan rol REVOKE qilsa — XATO BERMAYDI, jimgina
-- e'tiborsiz qoldiradi. Tekshirildi (2026-08-08): revoke'dan keyin ham
--   POST /rest/v1/rpc/pgaudit_ddl_command_end (anon) → HTTP 200.
-- Ta'siri: bu pgaudit kengaytmasining event-trigger funksiyasi; event trigger
-- kontekstidan tashqarida chaqirilganda hech narsa qilmaydi va ma'lumot
-- qaytarmaydi. Ya'ni advisor ogohlantirishi bizning tomondan YOPILMAYDI va
-- yopilishi ham shart emas. Blok kelajakda Supabase egalikni o'zgartirsa
-- o'z-o'zidan ishlashi uchun qoldirilgan.
-- MUHIM UMUMIY QOIDA: funksiyalarga EXECUTE standart holda PUBLIC'ga beriladi —
-- faqat anon/authenticated'dan olish YETARLI EMAS, PUBLIC ham kerak.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('pgaudit_ddl_command_end', 'pgaudit_sql_drop')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
  END LOOP;
END $$;

-- --- 2) can_access_branch ---------------------------------------------------
-- Hech qaysi policyda ishlatilmaydi (tekshirilgan: 0 ta) va ilova kodidan ham
-- chaqirilmaydi — faqat kelajakdagi multi-filial uchun yozilgan. Argument bilan
-- chaqirib boshqa foydalanuvchining filial huquqini bilib olish mumkin edi.
-- OGOHLANTIRISH: agar kelajakda bu funksiya policy ichida ishlatilsa,
-- authenticated'ga EXECUTE QAYTARILISHI SHART (yuqoridagi 4-banddagi tajriba).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'can_access_branch'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
  END LOOP;
END $$;

-- --- 3) search_path qadash --------------------------------------------------
-- search_path o'zgaruvchan bo'lsa, chaqiruvchi o'z sxemasini oldinga qo'yib
-- funksiya ichidagi nomlarni almashtira oladi (search_path hijacking).
-- Ikkalasi ham tanasi oddiy, shuning uchun qadash xatti-harakatni o'zgartirmaydi.
ALTER FUNCTION public.tg_set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.gl_cash_code(text, text) SET search_path = public, pg_temp;

NOTIFY pgrst, 'reload schema';
