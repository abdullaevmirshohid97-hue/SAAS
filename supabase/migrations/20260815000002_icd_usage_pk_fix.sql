-- =============================================================================
-- doctor_icd_usage — PK ni code_system'ni hisobga oladigan qilish
-- =============================================================================
-- Oldingi migratsiyada code_system qo'shildi, lekin PRIMARY KEY hali ham
-- (user_id, code) edi. Amaliyotda ICD-10 ("J06.9") va ICD-11 ("1A00") kod
-- formatlari boshqacha, to'qnashish ehtimoli past — lekin past emas NOL
-- degani emas. Xavfni to'liq yo'qotish uchun PK kengaytiriladi.
--
-- Xavfsiz: jadvalda 1 ta qator bor (tekshirildi), hammasi code_system='icd10'.
--
-- ORQAGA QAYTARISH: scripts/rollback-20260815-icd-normalization.sql ga
-- qo'shimcha band (pastda izohda).

ALTER TABLE doctor_icd_usage DROP CONSTRAINT doctor_icd_usage_pkey;
ALTER TABLE doctor_icd_usage
  ADD CONSTRAINT doctor_icd_usage_pkey PRIMARY KEY (user_id, code_system, code);

-- Orqaga qaytarish (rollback skriptiga qo'shimcha, agar kerak bo'lsa):
--   ALTER TABLE doctor_icd_usage DROP CONSTRAINT doctor_icd_usage_pkey;
--   ALTER TABLE doctor_icd_usage ADD CONSTRAINT doctor_icd_usage_pkey PRIMARY KEY (user_id, code);
