-- =============================================================================
-- Clary v2 — Migration 001070: RBAC permissions catalog (SSOT)
-- Stores the canonical permission keys (module.action format) referenced by:
--   * custom_roles.permissions (jsonb)
--   * profiles.permissions_override (jsonb)
--   * API @RequirePerm('module.action')
--   * Frontend <Can perm="module.action">
-- =============================================================================

CREATE TABLE IF NOT EXISTS permissions_catalog (
  key TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  label_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  description_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_roles TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  is_dangerous BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_perm_cat_module ON permissions_catalog(module, sort_order);

ALTER TABLE permissions_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_perm_cat_read ON permissions_catalog;
CREATE POLICY p_perm_cat_read ON permissions_catalog
  FOR SELECT USING (true);
DROP POLICY IF EXISTS p_perm_cat_admin ON permissions_catalog;
CREATE POLICY p_perm_cat_admin ON permissions_catalog
  FOR ALL
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

-- -----------------------------------------------------------------------------
-- Seed (full catalog). Format: key = 'module.action'
-- default_roles uses user_role enum values (clinic_owner, clinic_admin, doctor,
-- receptionist, cashier, pharmacist, lab_technician, radiologist, nurse, staff)
-- -----------------------------------------------------------------------------
INSERT INTO permissions_catalog (key, module, action, label_i18n, default_roles, is_dangerous, sort_order) VALUES
  -- Patients
  ('patients.view',            'patients','view',            '{"uz-Latn":"Bemorlarni ko''rish","ru":"Просмотр пациентов","en":"View patients"}'::jsonb, ARRAY['clinic_owner','clinic_admin','doctor','receptionist','nurse','cashier','pharmacist','lab_technician','radiologist'], false, 10),
  ('patients.create',          'patients','create',          '{"uz-Latn":"Bemor qo''shish","ru":"Добавить пациента","en":"Create patient"}'::jsonb,        ARRAY['clinic_owner','clinic_admin','receptionist'], false, 11),
  ('patients.edit',            'patients','edit',            '{"uz-Latn":"Bemorni tahrirlash","ru":"Редактировать пациента","en":"Edit patient"}'::jsonb, ARRAY['clinic_owner','clinic_admin','receptionist','doctor'], false, 12),
  ('patients.delete',          'patients','delete',          '{"uz-Latn":"Bemorni o''chirish","ru":"Удалить пациента","en":"Delete patient"}'::jsonb,     ARRAY['clinic_owner','clinic_admin'], true,  13),
  ('patients.export',          'patients','export',          '{"uz-Latn":"Eksport","ru":"Экспорт","en":"Export"}'::jsonb,                                   ARRAY['clinic_owner','clinic_admin'], false, 14),
  ('patients.view_phi',        'patients','view_phi',        '{"uz-Latn":"To''liq PII ko''rish","ru":"Видеть полные PHI","en":"View full PHI"}'::jsonb,   ARRAY['clinic_owner','clinic_admin','doctor'], false, 15),

  -- Appointments
  ('appointments.view',        'appointments','view',        '{"uz-Latn":"Navbatni ko''rish","ru":"Просмотр записей","en":"View appointments"}'::jsonb, ARRAY['clinic_owner','clinic_admin','doctor','receptionist','nurse'], false, 20),
  ('appointments.create',      'appointments','create',      '{"uz-Latn":"Yangi navbat","ru":"Создать запись","en":"Create appointment"}'::jsonb,     ARRAY['clinic_owner','clinic_admin','receptionist','doctor'], false, 21),
  ('appointments.edit',        'appointments','edit',        '{"uz-Latn":"Tahrirlash","ru":"Редактировать","en":"Edit"}'::jsonb,                      ARRAY['clinic_owner','clinic_admin','receptionist','doctor'], false, 22),
  ('appointments.cancel',      'appointments','cancel',      '{"uz-Latn":"Bekor qilish","ru":"Отменить","en":"Cancel"}'::jsonb,                       ARRAY['clinic_owner','clinic_admin','receptionist'], false, 23),
  ('appointments.reschedule',  'appointments','reschedule',  '{"uz-Latn":"Qayta rejalash","ru":"Перенести","en":"Reschedule"}'::jsonb,                ARRAY['clinic_owner','clinic_admin','receptionist','doctor'], false, 24),

  -- Queue
  ('queue.view',               'queue','view',               '{"uz-Latn":"Navbat","ru":"Очередь","en":"Queue"}'::jsonb,                               ARRAY['clinic_owner','clinic_admin','doctor','receptionist','nurse'], false, 30),
  ('queue.call_next',          'queue','call_next',          '{"uz-Latn":"Keyingisini chaqirish","ru":"Следующий","en":"Call next"}'::jsonb,           ARRAY['clinic_owner','clinic_admin','doctor','receptionist','nurse'], false, 31),
  ('queue.reassign',           'queue','reassign',           '{"uz-Latn":"Qayta tayinlash","ru":"Переназначить","en":"Reassign"}'::jsonb,              ARRAY['clinic_owner','clinic_admin','receptionist'], false, 32),
  ('queue.skip',               'queue','skip',               '{"uz-Latn":"O''tkazib yuborish","ru":"Пропустить","en":"Skip"}'::jsonb,                  ARRAY['clinic_owner','clinic_admin','doctor','receptionist'], false, 33),

  -- Doctor view / SOAP
  ('doctor_view.view',         'doctor_view','view',         '{"uz-Latn":"Shifokor oynasi","ru":"Кабинет врача","en":"Doctor view"}'::jsonb,         ARRAY['clinic_owner','clinic_admin','doctor'], false, 40),
  ('doctor_view.create_soap',  'doctor_view','create_soap',  '{"uz-Latn":"SOAP yozish","ru":"Создать SOAP","en":"Create SOAP"}'::jsonb,               ARRAY['clinic_owner','clinic_admin','doctor'], false, 41),
  ('doctor_view.edit_soap',    'doctor_view','edit_soap',    '{"uz-Latn":"SOAP tahrirlash (imzolanmagan)","ru":"Редактировать SOAP","en":"Edit SOAP"}'::jsonb, ARRAY['clinic_owner','clinic_admin','doctor'], false, 42),
  ('doctor_view.sign_note',    'doctor_view','sign_note',    '{"uz-Latn":"Imzolash","ru":"Подписать","en":"Sign"}'::jsonb,                            ARRAY['clinic_owner','clinic_admin','doctor'], false, 43),

  -- Prescriptions
  ('prescriptions.view',       'prescriptions','view',       '{"uz-Latn":"Retsept","ru":"Рецепты","en":"Prescriptions"}'::jsonb,                     ARRAY['clinic_owner','clinic_admin','doctor','pharmacist','nurse'], false, 50),
  ('prescriptions.create',     'prescriptions','create',     '{"uz-Latn":"Retsept yozish","ru":"Выписать рецепт","en":"Write prescription"}'::jsonb,  ARRAY['clinic_owner','clinic_admin','doctor'], false, 51),
  ('prescriptions.edit',       'prescriptions','edit',       '{"uz-Latn":"Tahrirlash","ru":"Редактировать","en":"Edit"}'::jsonb,                      ARRAY['clinic_owner','clinic_admin','doctor'], false, 52),
  ('prescriptions.cancel',     'prescriptions','cancel',     '{"uz-Latn":"Bekor qilish","ru":"Отменить","en":"Cancel"}'::jsonb,                       ARRAY['clinic_owner','clinic_admin','doctor'], false, 53),

  -- Lab
  ('lab.view',                 'lab','view',                 '{"uz-Latn":"Laboratoriya","ru":"Лаборатория","en":"Lab"}'::jsonb,                        ARRAY['clinic_owner','clinic_admin','doctor','lab_technician','nurse','receptionist'], false, 60),
  ('lab.create_order',         'lab','create_order',         '{"uz-Latn":"Yangi tahlil","ru":"Новый анализ","en":"New lab order"}'::jsonb,             ARRAY['clinic_owner','clinic_admin','doctor','lab_technician'], false, 61),
  ('lab.collect_sample',       'lab','collect_sample',       '{"uz-Latn":"Namuna olish","ru":"Забор образца","en":"Collect sample"}'::jsonb,           ARRAY['clinic_owner','clinic_admin','lab_technician','nurse'], false, 62),
  ('lab.enter_result',         'lab','enter_result',         '{"uz-Latn":"Natija kiritish","ru":"Ввод результата","en":"Enter result"}'::jsonb,         ARRAY['clinic_owner','clinic_admin','lab_technician'], false, 63),
  ('lab.report_result',        'lab','report_result',        '{"uz-Latn":"Natijani yuborish","ru":"Отправить результат","en":"Report result"}'::jsonb, ARRAY['clinic_owner','clinic_admin','lab_technician','doctor'], false, 64),
  ('lab.cancel_order',         'lab','cancel_order',         '{"uz-Latn":"Buyurtmani bekor qilish","ru":"Отменить заказ","en":"Cancel order"}'::jsonb, ARRAY['clinic_owner','clinic_admin','lab_technician','doctor'], false, 65),

  -- Diagnostics
  ('diagnostics.view',         'diagnostics','view',         '{"uz-Latn":"Diagnostika","ru":"Диагностика","en":"Diagnostics"}'::jsonb,                 ARRAY['clinic_owner','clinic_admin','doctor','radiologist','receptionist','nurse'], false, 70),
  ('diagnostics.create_order', 'diagnostics','create_order', '{"uz-Latn":"Buyurtma berish","ru":"Назначить","en":"Order"}'::jsonb,                   ARRAY['clinic_owner','clinic_admin','doctor','radiologist'], false, 71),
  ('diagnostics.perform',      'diagnostics','perform',      '{"uz-Latn":"Bajarish","ru":"Выполнить","en":"Perform"}'::jsonb,                         ARRAY['clinic_owner','clinic_admin','radiologist'], false, 72),
  ('diagnostics.report',       'diagnostics','report',       '{"uz-Latn":"Xulosa yozish","ru":"Заключение","en":"Report"}'::jsonb,                    ARRAY['clinic_owner','clinic_admin','radiologist','doctor'], false, 73),
  ('diagnostics.manage_equipment','diagnostics','manage_equipment','{"uz-Latn":"Aparatlarni boshqarish","ru":"Оборудование","en":"Manage equipment"}'::jsonb, ARRAY['clinic_owner','clinic_admin'], false, 74),

  -- Dental
  ('dental.view',              'dental','view',              '{"uz-Latn":"Stomatologiya","ru":"Стоматология","en":"Dental"}'::jsonb,                  ARRAY['clinic_owner','clinic_admin','doctor'], false, 75),
  ('dental.edit_chart',        'dental','edit_chart',        '{"uz-Latn":"Tish xartasini tahrirlash","ru":"Редактировать карту","en":"Edit chart"}'::jsonb, ARRAY['clinic_owner','clinic_admin','doctor'], false, 76),
  ('dental.manage_plan',       'dental','manage_plan',       '{"uz-Latn":"Davolash rejasi","ru":"План лечения","en":"Treatment plan"}'::jsonb,        ARRAY['clinic_owner','clinic_admin','doctor'], false, 77),

  -- Pharmacy
  ('pharmacy.view',            'pharmacy','view',            '{"uz-Latn":"Dorixona","ru":"Аптека","en":"Pharmacy"}'::jsonb,                            ARRAY['clinic_owner','clinic_admin','pharmacist','cashier'], false, 80),
  ('pharmacy.dispense',        'pharmacy','dispense',        '{"uz-Latn":"Dori berish","ru":"Отпуск","en":"Dispense"}'::jsonb,                         ARRAY['clinic_owner','clinic_admin','pharmacist'], false, 81),
  ('pharmacy.receive_stock',   'pharmacy','receive_stock',   '{"uz-Latn":"Kirim","ru":"Приход","en":"Receive stock"}'::jsonb,                         ARRAY['clinic_owner','clinic_admin','pharmacist'], false, 82),
  ('pharmacy.edit_stock',      'pharmacy','edit_stock',      '{"uz-Latn":"Ombor tahrirlash","ru":"Склад","en":"Edit stock"}'::jsonb,                   ARRAY['clinic_owner','clinic_admin','pharmacist'], true,  83),
  ('pharmacy.adjust',          'pharmacy','adjust',          '{"uz-Latn":"Korreksiya","ru":"Корректировка","en":"Adjust"}'::jsonb,                     ARRAY['clinic_owner','clinic_admin'], true,  84),

  -- Medications catalog
  ('medications.view',         'medications','view',         '{"uz-Latn":"Dorilar ro''yxati","ru":"Список лекарств","en":"Medications"}'::jsonb,      ARRAY['clinic_owner','clinic_admin','pharmacist','doctor','cashier'], false, 85),
  ('medications.create',       'medications','create',       '{"uz-Latn":"Dori qo''shish","ru":"Добавить лекарство","en":"Create medication"}'::jsonb, ARRAY['clinic_owner','clinic_admin','pharmacist'], false, 86),
  ('medications.edit',         'medications','edit',         '{"uz-Latn":"Tahrirlash","ru":"Редактировать","en":"Edit"}'::jsonb,                      ARRAY['clinic_owner','clinic_admin','pharmacist'], false, 87),
  ('medications.edit_price',   'medications','edit_price',   '{"uz-Latn":"Narx o''zgartirish","ru":"Изменить цену","en":"Edit price"}'::jsonb,        ARRAY['clinic_owner','clinic_admin'], false, 88),
  ('medications.delete',       'medications','delete',       '{"uz-Latn":"O''chirish","ru":"Удалить","en":"Delete"}'::jsonb,                          ARRAY['clinic_owner','clinic_admin'], true,  89),

  -- Cashier
  ('cashier.view',             'cashier','view',             '{"uz-Latn":"Kassa","ru":"Касса","en":"Cashier"}'::jsonb,                                ARRAY['clinic_owner','clinic_admin','cashier'], false, 90),
  ('cashier.accept_payment',   'cashier','accept_payment',   '{"uz-Latn":"To''lov qabul qilish","ru":"Приём оплаты","en":"Accept payment"}'::jsonb, ARRAY['clinic_owner','clinic_admin','cashier'], false, 91),
  ('cashier.refund',           'cashier','refund',           '{"uz-Latn":"Qaytarish","ru":"Возврат","en":"Refund"}'::jsonb,                           ARRAY['clinic_owner','clinic_admin','cashier'], true,  92),
  ('cashier.void',             'cashier','void',             '{"uz-Latn":"Bekor qilish (void)","ru":"Аннулировать","en":"Void"}'::jsonb,              ARRAY['clinic_owner','clinic_admin'], true,  93),
  ('cashier.close_shift',      'cashier','close_shift',      '{"uz-Latn":"Smenani yopish","ru":"Закрыть смену","en":"Close shift"}'::jsonb,            ARRAY['clinic_owner','clinic_admin','cashier'], false, 94),
  ('cashier.view_all_shifts',  'cashier','view_all_shifts',  '{"uz-Latn":"Barcha smenalar","ru":"Все смены","en":"All shifts"}'::jsonb,               ARRAY['clinic_owner','clinic_admin'], false, 95),

  -- Inpatient
  ('inpatient.view',           'inpatient','view',           '{"uz-Latn":"Statsionar","ru":"Стационар","en":"Inpatient"}'::jsonb,                     ARRAY['clinic_owner','clinic_admin','doctor','nurse','receptionist'], false, 100),
  ('inpatient.admit',          'inpatient','admit',          '{"uz-Latn":"Yotqizish","ru":"Госпитализировать","en":"Admit"}'::jsonb,                  ARRAY['clinic_owner','clinic_admin','doctor','receptionist'], false, 101),
  ('inpatient.discharge',      'inpatient','discharge',      '{"uz-Latn":"Chiqarish","ru":"Выписать","en":"Discharge"}'::jsonb,                       ARRAY['clinic_owner','clinic_admin','doctor'], false, 102),
  ('inpatient.transfer_bed',   'inpatient','transfer_bed',   '{"uz-Latn":"Xona o''zgartirish","ru":"Перевести","en":"Transfer bed"}'::jsonb,          ARRAY['clinic_owner','clinic_admin','doctor','nurse'], false, 103),

  -- Nurse tasks & home-nurse
  ('nurse.view_tasks',         'nurse','view_tasks',         '{"uz-Latn":"Hamshira vazifalari","ru":"Задачи медсестры","en":"Nurse tasks"}'::jsonb,   ARRAY['clinic_owner','clinic_admin','nurse','doctor'], false, 110),
  ('nurse.complete_task',      'nurse','complete_task',      '{"uz-Latn":"Vazifani bajarish","ru":"Выполнить задачу","en":"Complete task"}'::jsonb,   ARRAY['clinic_owner','clinic_admin','nurse'], false, 111),
  ('nurse.emergency_broadcast','nurse','emergency_broadcast','{"uz-Latn":"Tezkor chaqiruv","ru":"Экстренный вызов","en":"Emergency broadcast"}'::jsonb, ARRAY['clinic_owner','clinic_admin','nurse','doctor','receptionist'], false, 112),
  ('home_nurse.view',          'home_nurse','view',          '{"uz-Latn":"Uy hamshirasi","ru":"Домашняя медсестра","en":"Home nurse"}'::jsonb,        ARRAY['clinic_owner','clinic_admin','nurse','receptionist'], false, 113),
  ('home_nurse.accept_request','home_nurse','accept_request','{"uz-Latn":"So''rov qabul qilish","ru":"Принять запрос","en":"Accept request"}'::jsonb,  ARRAY['clinic_owner','clinic_admin','receptionist'], false, 114),
  ('home_nurse.assign_nurse',  'home_nurse','assign_nurse',  '{"uz-Latn":"Hamshira tayinlash","ru":"Назначить медсестру","en":"Assign nurse"}'::jsonb, ARRAY['clinic_owner','clinic_admin'], false, 115),
  ('home_nurse.manage_tariffs','home_nurse','manage_tariffs','{"uz-Latn":"Tariflarni boshqarish","ru":"Управление тарифами","en":"Manage tariffs"}'::jsonb, ARRAY['clinic_owner','clinic_admin'], false, 116),

  -- Marketing
  ('marketing.view',           'marketing','view',           '{"uz-Latn":"Marketing","ru":"Маркетинг","en":"Marketing"}'::jsonb,                      ARRAY['clinic_owner','clinic_admin'], false, 120),
  ('marketing.create_campaign','marketing','create_campaign','{"uz-Latn":"Kampaniya yaratish","ru":"Создать кампанию","en":"Create campaign"}'::jsonb, ARRAY['clinic_owner','clinic_admin'], false, 121),
  ('marketing.send_campaign',  'marketing','send_campaign',  '{"uz-Latn":"Yuborish","ru":"Отправить","en":"Send campaign"}'::jsonb,                   ARRAY['clinic_owner','clinic_admin'], true,  122),
  ('marketing.manage_segments','marketing','manage_segments','{"uz-Latn":"Segmentlar","ru":"Сегменты","en":"Segments"}'::jsonb,                      ARRAY['clinic_owner','clinic_admin'], false, 123),
  ('marketing.manage_loyalty', 'marketing','manage_loyalty', '{"uz-Latn":"Loyalty","ru":"Лояльность","en":"Loyalty"}'::jsonb,                         ARRAY['clinic_owner','clinic_admin'], false, 124),

  -- Analytics
  ('analytics.view_self',      'analytics','view_self',      '{"uz-Latn":"O''z analitikam","ru":"Моя аналитика","en":"My analytics"}'::jsonb,          ARRAY['clinic_owner','clinic_admin','doctor'], false, 130),
  ('analytics.view_clinic',    'analytics','view_clinic',    '{"uz-Latn":"Klinika analitikasi","ru":"Аналитика клиники","en":"Clinic analytics"}'::jsonb, ARRAY['clinic_owner','clinic_admin'], false, 131),
  ('analytics.export',         'analytics','export',         '{"uz-Latn":"Eksport","ru":"Экспорт","en":"Export"}'::jsonb,                              ARRAY['clinic_owner','clinic_admin'], false, 132),

  -- Payroll
  ('payroll.view_own',         'payroll','view_own',         '{"uz-Latn":"O''z oyligim","ru":"Моя зарплата","en":"My payroll"}'::jsonb,                 ARRAY['clinic_owner','clinic_admin','doctor','nurse','cashier','pharmacist'], false, 140),
  ('payroll.view_all',         'payroll','view_all',         '{"uz-Latn":"Barcha oylik","ru":"Вся зарплата","en":"All payroll"}'::jsonb,               ARRAY['clinic_owner','clinic_admin'], false, 141),
  ('payroll.pay_salary',       'payroll','pay_salary',       '{"uz-Latn":"Oylik to''lash","ru":"Выплатить","en":"Pay salary"}'::jsonb,                ARRAY['clinic_owner','clinic_admin'], true,  142),
  ('payroll.manage_rates',     'payroll','manage_rates',     '{"uz-Latn":"Stavkalarni boshqarish","ru":"Ставки","en":"Rates"}'::jsonb,                ARRAY['clinic_owner','clinic_admin'], false, 143),

  -- Staff
  ('staff.view',               'staff','view',               '{"uz-Latn":"Xodimlar","ru":"Персонал","en":"Staff"}'::jsonb,                            ARRAY['clinic_owner','clinic_admin'], false, 150),
  ('staff.invite',             'staff','invite',             '{"uz-Latn":"Taklif qilish","ru":"Пригласить","en":"Invite"}'::jsonb,                     ARRAY['clinic_owner','clinic_admin'], false, 151),
  ('staff.edit',               'staff','edit',               '{"uz-Latn":"Tahrirlash","ru":"Редактировать","en":"Edit"}'::jsonb,                      ARRAY['clinic_owner','clinic_admin'], false, 152),
  ('staff.deactivate',         'staff','deactivate',         '{"uz-Latn":"O''chirish","ru":"Отключить","en":"Deactivate"}'::jsonb,                     ARRAY['clinic_owner','clinic_admin'], true,  153),
  ('staff.manage_roles',       'staff','manage_roles',       '{"uz-Latn":"Rollarni boshqarish","ru":"Роли","en":"Manage roles"}'::jsonb,              ARRAY['clinic_owner','clinic_admin'], true,  154),
  ('staff.manage_permissions', 'staff','manage_permissions', '{"uz-Latn":"Ruxsatlarni boshqarish","ru":"Разрешения","en":"Permissions"}'::jsonb,      ARRAY['clinic_owner','clinic_admin'], true,  155),

  -- Settings
  ('settings.view',            'settings','view',            '{"uz-Latn":"Sozlamalar","ru":"Настройки","en":"Settings"}'::jsonb,                      ARRAY['clinic_owner','clinic_admin'], false, 160),
  ('settings.edit_clinic',     'settings','edit_clinic',     '{"uz-Latn":"Klinika ma''lumotlari","ru":"Данные клиники","en":"Clinic info"}'::jsonb,  ARRAY['clinic_owner','clinic_admin'], false, 161),
  ('settings.edit_branding',   'settings','edit_branding',   '{"uz-Latn":"Brending","ru":"Брендинг","en":"Branding"}'::jsonb,                          ARRAY['clinic_owner','clinic_admin'], false, 162),
  ('settings.manage_integrations','settings','manage_integrations','{"uz-Latn":"Integratsiyalar","ru":"Интеграции","en":"Integrations"}'::jsonb,    ARRAY['clinic_owner','clinic_admin'], false, 163),
  ('settings.manage_catalog',  'settings','manage_catalog',  '{"uz-Latn":"Katalog","ru":"Каталог","en":"Catalog"}'::jsonb,                            ARRAY['clinic_owner','clinic_admin'], false, 164),
  ('settings.manage_online_queue','settings','manage_online_queue','{"uz-Latn":"Onlayn navbat","ru":"Онлайн очередь","en":"Online queue"}'::jsonb,   ARRAY['clinic_owner','clinic_admin'], false, 165),

  -- Audit
  ('audit.view',               'audit','view',               '{"uz-Latn":"Audit jurnali","ru":"Журнал аудита","en":"Audit log"}'::jsonb,              ARRAY['clinic_owner','clinic_admin'], false, 170),

  -- Support chat
  ('support.view',             'support','view',             '{"uz-Latn":"Yordam","ru":"Поддержка","en":"Support"}'::jsonb,                            ARRAY['clinic_owner','clinic_admin','doctor','receptionist','nurse','cashier','pharmacist','lab_technician','radiologist'], false, 180),
  ('support.send_message',     'support','send_message',     '{"uz-Latn":"Xabar yuborish","ru":"Отправить","en":"Send message"}'::jsonb,              ARRAY['clinic_owner','clinic_admin','doctor','receptionist','nurse','cashier','pharmacist','lab_technician','radiologist'], false, 181)
ON CONFLICT (key) DO UPDATE
  SET label_i18n = EXCLUDED.label_i18n,
      default_roles = EXCLUDED.default_roles,
      is_dangerous = EXCLUDED.is_dangerous,
      sort_order = EXCLUDED.sort_order;

COMMENT ON TABLE permissions_catalog IS 'SSOT for RBAC permission keys (module.action); referenced by API @RequirePerm and frontend <Can>';
