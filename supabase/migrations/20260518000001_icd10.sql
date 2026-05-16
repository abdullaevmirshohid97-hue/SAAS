-- =============================================================================
-- ICD-10 tasniflagichi — eng ko'p ishlatiladigan ~500 kod, 3 tilda (uz/ru/en)
-- =============================================================================
-- WHO ICD-10 / МКБ-10. O'zbek tibbiy atamalar bilan.
-- Shifokor consultation workspace'da tashxis kodini qidirib tanlaydi.

CREATE TABLE IF NOT EXISTS icd10_codes (
  code        TEXT PRIMARY KEY,          -- 'E11.9'
  name_uz     TEXT NOT NULL,
  name_ru     TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  category    CHAR(1) NOT NULL,          -- 'E' bo'lim harfi
  chapter     TEXT NOT NULL,             -- bo'lim nomi (uz)
  search_text TEXT NOT NULL,             -- 3 til + sinonimlar (lowercase)
  is_common   BOOLEAN NOT NULL DEFAULT true
);

-- Trigram qidiruv (uz/ru/en — har qanday tilda yozsa topadi)
CREATE INDEX IF NOT EXISTS idx_icd10_search_trgm
  ON icd10_codes USING GIN (search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_icd10_category ON icd10_codes(category);

-- ICD-10 — global reference jadval, RLS kerak emas (har klinika o'qiydi).
ALTER TABLE icd10_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_icd10_read ON icd10_codes;
CREATE POLICY p_icd10_read ON icd10_codes FOR SELECT USING (true);

COMMENT ON TABLE icd10_codes IS
  'ICD-10 (МКБ-10) tasniflagichi. Global reference — barcha klinikalar uchun '
  'umumiy. Shifokor tashxis kodini qidirib tanlaydi.';

-- -----------------------------------------------------------------------------
-- Qidiruv RPC — uz/ru/en bo'yicha, trigram similarity bilan tartiblangan
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_icd10(p_query TEXT, p_limit INT DEFAULT 20)
RETURNS TABLE (
  code TEXT,
  name_uz TEXT,
  name_ru TEXT,
  name_en TEXT,
  category CHAR(1)
)
LANGUAGE sql STABLE
AS $$
  SELECT c.code, c.name_uz, c.name_ru, c.name_en, c.category
    FROM icd10_codes c
   WHERE c.search_text ILIKE '%' || lower(p_query) || '%'
      OR c.code ILIKE p_query || '%'
   ORDER BY
     -- Kod bilan boshlansa eng yuqorida
     CASE WHEN c.code ILIKE p_query || '%' THEN 0 ELSE 1 END,
     similarity(c.search_text, lower(p_query)) DESC,
     c.code
   LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION search_icd10(TEXT, INT) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Dataset — kategoriyalar bo'yicha eng ko'p ishlatiladigan kodlar
-- -----------------------------------------------------------------------------
INSERT INTO icd10_codes (code, name_uz, name_ru, name_en, category, chapter, search_text) VALUES

-- ===== A-B: Yuqumli kasalliklar =====
('A09', 'Infeksion gastroenterit va kolit', 'Инфекционный гастроэнтерит и колит', 'Infectious gastroenteritis and colitis', 'A', 'Yuqumli kasalliklar', 'a09 infeksion gastroenterit kolit ich ketishi инфекционный гастроэнтерит колит понос gastroenteritis colitis diarrhea'),
('A15', 'Nafas a''zolari sili', 'Туберкулёз органов дыхания', 'Respiratory tuberculosis', 'A', 'Yuqumli kasalliklar', 'a15 sil tuberkulyoz nafas o''pka туберкулёз органов дыхания respiratory tuberculosis tb'),
('A41.9', 'Sepsis, aniqlanmagan', 'Сепсис неуточнённый', 'Sepsis, unspecified', 'A', 'Yuqumli kasalliklar', 'a41 sepsis qon zaharlanishi сепсис заражение крови sepsis'),
('B00.9', 'Gerpetik infeksiya, aniqlanmagan', 'Герпетическая инфекция неуточнённая', 'Herpesviral infection, unspecified', 'B', 'Yuqumli kasalliklar', 'b00 gerpes uchuq герпес herpes'),
('B18.1', 'Surunkali B virusli gepatit', 'Хронический вирусный гепатит B', 'Chronic viral hepatitis B', 'B', 'Yuqumli kasalliklar', 'b18 gepatit b virusli jigar гепатит б hepatitis b'),
('B18.2', 'Surunkali C virusli gepatit', 'Хронический вирусный гепатит C', 'Chronic viral hepatitis C', 'B', 'Yuqumli kasalliklar', 'b18 gepatit c virusli jigar гепатит ц hepatitis c'),
('B34.9', 'Virusli infeksiya, aniqlanmagan', 'Вирусная инфекция неуточнённая', 'Viral infection, unspecified', 'B', 'Yuqumli kasalliklar', 'b34 virusli infeksiya вирусная инфекция viral infection'),
('B86', 'Qichima (chesotka)', 'Чесотка', 'Scabies', 'B', 'Yuqumli kasalliklar', 'b86 qichima chesotka чесотка scabies'),

-- ===== C-D: O'smalar =====
('C50.9', 'Sut bezi yomon sifatli o''smasi', 'Злокачественное новообразование молочной железы', 'Malignant neoplasm of breast', 'C', 'O''smalar', 'c50 sut bezi rak o''sma злокачественное молочной железы breast cancer'),
('C34.9', 'O''pka yomon sifatli o''smasi', 'Злокачественное новообразование лёгкого', 'Malignant neoplasm of lung', 'C', 'O''smalar', 'c34 o''pka rak o''sma злокачественное лёгкого lung cancer'),
('C16.9', 'Oshqozon yomon sifatli o''smasi', 'Злокачественное новообразование желудка', 'Malignant neoplasm of stomach', 'C', 'O''smalar', 'c16 oshqozon rak o''sma злокачественное желудка stomach cancer'),
('D17.9', 'Lipoma, aniqlanmagan', 'Липома неуточнённая', 'Lipoma, unspecified', 'D', 'O''smalar', 'd17 lipoma yog'' o''sma липома lipoma'),
('D25.9', 'Bachadon leyomiomasi', 'Лейомиома матки', 'Leiomyoma of uterus', 'D', 'O''smalar', 'd25 bachadon mioma leyomioma миома матки uterine fibroid'),
('D50.9', 'Temir tanqisligi anemiyasi', 'Железодефицитная анемия', 'Iron deficiency anaemia', 'D', 'Qon kasalliklari', 'd50 anemiya kamqonlik temir tanqisligi анемия малокровие железодефицитная iron deficiency anaemia'),
('D64.9', 'Anemiya, aniqlanmagan', 'Анемия неуточнённая', 'Anaemia, unspecified', 'D', 'Qon kasalliklari', 'd64 anemiya kamqonlik анемия малокровие anaemia'),

-- ===== E: Endokrin, ovqatlanish, modda almashinuvi =====
('E03.9', 'Gipotireoz, aniqlanmagan', 'Гипотиреоз неуточнённый', 'Hypothyroidism, unspecified', 'E', 'Endokrin kasalliklar', 'e03 gipotireoz qalqonsimon bez гипотиреоз щитовидная hypothyroidism'),
('E04.9', 'Toksiksiz buqoq, aniqlanmagan', 'Нетоксический зоб неуточнённый', 'Nontoxic goitre, unspecified', 'E', 'Endokrin kasalliklar', 'e04 buqoq zob qalqonsimon нетоксический зоб goitre'),
('E05.9', 'Tireotoksikoz, aniqlanmagan', 'Тиреотоксикоз неуточнённый', 'Thyrotoxicosis, unspecified', 'E', 'Endokrin kasalliklar', 'e05 tireotoksikoz gipertireoz тиреотоксикоз thyrotoxicosis hyperthyroidism'),
('E10.9', '1-tip qandli diabet, asoratsiz', 'Сахарный диабет 1 типа без осложнений', 'Type 1 diabetes mellitus without complications', 'E', 'Endokrin kasalliklar', 'e10 diabet qand 1 tip qandli сахарный диабет 1 типа type 1 diabetes'),
('E11.9', '2-tip qandli diabet, asoratsiz', 'Сахарный диабет 2 типа без осложнений', 'Type 2 diabetes mellitus without complications', 'E', 'Endokrin kasalliklar', 'e11 diabet qand 2 tip qandli saxar сахарный диабет 2 типа type 2 diabetes'),
('E11.2', '2-tip diabet, buyrak asorati bilan', 'Сахарный диабет 2 типа с поражением почек', 'Type 2 diabetes with kidney complications', 'E', 'Endokrin kasalliklar', 'e11 diabet buyrak nefropatiya сахарный диабет почки diabetic nephropathy'),
('E66.9', 'Semizlik, aniqlanmagan', 'Ожирение неуточнённое', 'Obesity, unspecified', 'E', 'Endokrin kasalliklar', 'e66 semizlik vazn ожирение полнота obesity'),
('E78.5', 'Giperlipidemiya, aniqlanmagan', 'Гиперлипидемия неуточнённая', 'Hyperlipidaemia, unspecified', 'E', 'Endokrin kasalliklar', 'e78 xolesterin giperlipidemiya холестерин гиперлипидемия cholesterol hyperlipidaemia'),
('E86', 'Suyuqlik hajmining kamayishi (degidratatsiya)', 'Уменьшение объёма жидкости (обезвоживание)', 'Volume depletion (dehydration)', 'E', 'Endokrin kasalliklar', 'e86 degidratatsiya suvsizlanish обезвоживание dehydration'),

-- ===== F: Ruhiy kasalliklar =====
('F32.9', 'Depressiv epizod, aniqlanmagan', 'Депрессивный эпизод неуточнённый', 'Depressive episode, unspecified', 'F', 'Ruhiy kasalliklar', 'f32 depressiya tushkunlik депрессия depression'),
('F41.9', 'Tashvishli buzilish, aniqlanmagan', 'Тревожное расстройство неуточнённое', 'Anxiety disorder, unspecified', 'F', 'Ruhiy kasalliklar', 'f41 tashvish xavotir nevroz тревога невроз anxiety'),
('F43.1', 'Posttravmatik stress buzilishi', 'Посттравматическое стрессовое расстройство', 'Post-traumatic stress disorder', 'F', 'Ruhiy kasalliklar', 'f43 ptsr stress travma птср стресс ptsd'),
('F45.9', 'Somatoform buzilish', 'Соматоформное расстройство', 'Somatoform disorder', 'F', 'Ruhiy kasalliklar', 'f45 somatoform соматоформное somatoform'),
('F51.0', 'Uyqusizlik (organik bo''lmagan)', 'Бессонница неорганической природы', 'Nonorganic insomnia', 'F', 'Ruhiy kasalliklar', 'f51 uyqusizlik бессонница insomnia'),

-- ===== G: Asab tizimi =====
('G40.9', 'Epilepsiya, aniqlanmagan', 'Эпилепсия неуточнённая', 'Epilepsy, unspecified', 'G', 'Asab kasalliklari', 'g40 epilepsiya tutqanoq эпилепсия epilepsy seizure'),
('G43.9', 'Migren, aniqlanmagan', 'Мигрень неуточнённая', 'Migraine, unspecified', 'G', 'Asab kasalliklari', 'g43 migren bosh og''riq мигрень migraine headache'),
('G44.2', 'Zo''riqish bosh og''rig''i', 'Головная боль напряжённого типа', 'Tension-type headache', 'G', 'Asab kasalliklari', 'g44 bosh og''riq zo''riqish головная боль напряжения tension headache'),
('G47.0', 'Uyquga ketish va uyquni saqlash buzilishi', 'Нарушения засыпания и поддержания сна', 'Insomnia', 'G', 'Asab kasalliklari', 'g47 uyqu buzilishi бессонница нарушение сна insomnia sleep'),
('G47.3', 'Uyqu apnoesi', 'Апноэ во сне', 'Sleep apnoea', 'G', 'Asab kasalliklari', 'g47 apnoe uyqu апноэ sleep apnea'),
('G54.1', 'Bel-dumg''aza chigali shikastlanishi', 'Поражения пояснично-крестцового сплетения', 'Lumbosacral plexus disorders', 'G', 'Asab kasalliklari', 'g54 radikulit bel chigal радикулит сплетение radiculopathy'),
('G62.9', 'Polineyropatiya, aniqlanmagan', 'Полинейропатия неуточнённая', 'Polyneuropathy, unspecified', 'G', 'Asab kasalliklari', 'g62 polineyropatiya nerv полинейропатия polyneuropathy'),

-- ===== H: Ko'z va quloq =====
('H10.9', 'Konyunktivit, aniqlanmagan', 'Конъюнктивит неуточнённый', 'Conjunctivitis, unspecified', 'H', 'Ko''z kasalliklari', 'h10 konyunktivit ko''z konъюнктивит conjunctivitis pink eye'),
('H25.9', 'Keksalik kataraktasi', 'Старческая катаракта', 'Senile cataract', 'H', 'Ko''z kasalliklari', 'h25 katarakta ko''z parda катаракта cataract'),
('H40.9', 'Glaukoma, aniqlanmagan', 'Глаукома неуточнённая', 'Glaucoma, unspecified', 'H', 'Ko''z kasalliklari', 'h40 glaukoma ko''z bosim глаукома glaucoma'),
('H52.1', 'Miopiya (yaqindan ko''rish)', 'Миопия (близорукость)', 'Myopia', 'H', 'Ko''z kasalliklari', 'h52 miopiya yaqindan ko''rish близорукость myopia'),
('H52.4', 'Presbiopiya', 'Пресбиопия', 'Presbyopia', 'H', 'Ko''z kasalliklari', 'h52 presbiopiya uzoqdan пресбиопия presbyopia'),
('H61.2', 'Quloqdagi oltingugurt tiqini', 'Серная пробка', 'Impacted cerumen', 'H', 'Quloq kasalliklari', 'h61 quloq tiqin oltingugurt серная пробка earwax cerumen'),
('H66.9', 'O''rta quloq yallig''lanishi (otit)', 'Средний отит неуточнённый', 'Otitis media, unspecified', 'H', 'Quloq kasalliklari', 'h66 otit quloq yallig''lanish средний отит otitis media ear infection'),
('H81.0', 'Menyer kasalligi', 'Болезнь Меньера', 'Meniere disease', 'H', 'Quloq kasalliklari', 'h81 menyer bosh aylanish болезнь меньера meniere vertigo'),
('H90.3', 'Sensonevral karlik, ikki tomonlama', 'Нейросенсорная тугоухость двусторонняя', 'Sensorineural hearing loss, bilateral', 'H', 'Quloq kasalliklari', 'h90 karlik eshitish тугоухость глухота hearing loss'),

-- ===== I: Yurak-qon tomir =====
('I10', 'Essensial (birlamchi) gipertenziya', 'Эссенциальная (первичная) гипертензия', 'Essential (primary) hypertension', 'I', 'Yurak-qon tomir kasalliklari', 'i10 gipertenziya qon bosim gipertoniya гипертензия давление гипертония hypertension high blood pressure'),
('I11.9', 'Gipertonik yurak kasalligi', 'Гипертензивная болезнь сердца', 'Hypertensive heart disease', 'I', 'Yurak-qon tomir kasalliklari', 'i11 gipertonik yurak гипертензивная сердце hypertensive heart'),
('I20.9', 'Stenokardiya, aniqlanmagan', 'Стенокардия неуточнённая', 'Angina pectoris, unspecified', 'I', 'Yurak-qon tomir kasalliklari', 'i20 stenokardiya ko''krak og''riq стенокардия angina'),
('I21.9', 'O''tkir miokard infarkti', 'Острый инфаркт миокарда', 'Acute myocardial infarction', 'I', 'Yurak-qon tomir kasalliklari', 'i21 infarkt yurak инфаркт миокарда heart attack myocardial infarction'),
('I25.9', 'Surunkali yurak ishemik kasalligi', 'Хроническая ишемическая болезнь сердца', 'Chronic ischaemic heart disease', 'I', 'Yurak-qon tomir kasalliklari', 'i25 ishemiya yurak iyub ишемическая болезнь сердца ischemic heart disease'),
('I48', 'Bo''lmacha fibrillyatsiyasi', 'Фибрилляция предсердий', 'Atrial fibrillation', 'I', 'Yurak-qon tomir kasalliklari', 'i48 aritmiya fibrillyatsiya мерцательная аритмия atrial fibrillation'),
('I49.9', 'Yurak aritmiyasi, aniqlanmagan', 'Аритмия сердца неуточнённая', 'Cardiac arrhythmia, unspecified', 'I', 'Yurak-qon tomir kasalliklari', 'i49 aritmiya yurak ritmi аритмия arrhythmia'),
('I50.9', 'Yurak yetishmovchiligi', 'Сердечная недостаточность', 'Heart failure', 'I', 'Yurak-qon tomir kasalliklari', 'i50 yurak yetishmovchilik сердечная недостаточность heart failure'),
('I63.9', 'Miya infarkti (insult)', 'Инфаркт мозга (инсульт)', 'Cerebral infarction', 'I', 'Yurak-qon tomir kasalliklari', 'i63 insult miya infarkt инсульт инфаркт мозга stroke'),
('I83.9', 'Oyoq venalari varikozi', 'Варикозное расширение вен ног', 'Varicose veins of lower extremities', 'I', 'Yurak-qon tomir kasalliklari', 'i83 varikoz vena oyoq варикоз вены varicose veins'),
('I84.9', 'Bavosil (gemorroy)', 'Геморрой', 'Haemorrhoids', 'I', 'Yurak-qon tomir kasalliklari', 'i84 bavosil gemorroy геморрой haemorrhoids piles'),
('I88.9', 'Limfadenit, aniqlanmagan', 'Лимфаденит неуточнённый', 'Nonspecific lymphadenitis', 'I', 'Yurak-qon tomir kasalliklari', 'i88 limfadenit limfa tugun лимфаденит lymphadenitis'),
('I95.9', 'Gipotenziya, aniqlanmagan', 'Гипотензия неуточнённая', 'Hypotension, unspecified', 'I', 'Yurak-qon tomir kasalliklari', 'i95 gipotenziya past bosim гипотензия низкое давление hypotension'),

-- ===== J: Nafas yo'llari =====
('J00', 'O''tkir nazofaringit (tumov)', 'Острый назофарингит (насморк)', 'Acute nasopharyngitis (common cold)', 'J', 'Nafas yo''llari kasalliklari', 'j00 tumov shamollash nazofaringit насморк простуда common cold'),
('J01.9', 'O''tkir sinusit, aniqlanmagan', 'Острый синусит неуточнённый', 'Acute sinusitis, unspecified', 'J', 'Nafas yo''llari kasalliklari', 'j01 sinusit gaymorit синусит гайморит sinusitis'),
('J02.9', 'O''tkir faringit, aniqlanmagan', 'Острый фарингит неуточнённый', 'Acute pharyngitis, unspecified', 'J', 'Nafas yo''llari kasalliklari', 'j02 faringit tomoq og''riq фарингит горло pharyngitis sore throat'),
('J03.9', 'O''tkir tonzillit, aniqlanmagan', 'Острый тонзиллит неуточнённый', 'Acute tonsillitis, unspecified', 'J', 'Nafas yo''llari kasalliklari', 'j03 tonzillit angina bodomcha тонзиллит ангина tonsillitis'),
('J04.0', 'O''tkir laringit', 'Острый ларингит', 'Acute laryngitis', 'J', 'Nafas yo''llari kasalliklari', 'j04 laringit tovush ларингит laryngitis'),
('J06.9', 'O''tkir yuqori nafas yo''li infeksiyasi', 'Острая инфекция верхних дыхательных путей', 'Acute upper respiratory infection', 'J', 'Nafas yo''llari kasalliklari', 'j06 orvi shamollash sovuq tekkan nafas орви простуда верхних дыхательных uri upper respiratory'),
('J11.1', 'Gripp, virus aniqlanmagan', 'Грипп, вирус не идентифицирован', 'Influenza, virus not identified', 'J', 'Nafas yo''llari kasalliklari', 'j11 gripp грипп influenza flu'),
('J18.9', 'Pnevmoniya, aniqlanmagan', 'Пневмония неуточнённая', 'Pneumonia, unspecified', 'J', 'Nafas yo''llari kasalliklari', 'j18 pnevmoniya o''pka yallig''lanish пневмония воспаление лёгких pneumonia'),
('J20.9', 'O''tkir bronxit, aniqlanmagan', 'Острый бронхит неуточнённый', 'Acute bronchitis, unspecified', 'J', 'Nafas yo''llari kasalliklari', 'j20 bronxit бронхит bronchitis'),
('J32.9', 'Surunkali sinusit', 'Хронический синусит', 'Chronic sinusitis', 'J', 'Nafas yo''llari kasalliklari', 'j32 surunkali sinusit хронический синусит chronic sinusitis'),
('J35.0', 'Surunkali tonzillit', 'Хронический тонзиллит', 'Chronic tonsillitis', 'J', 'Nafas yo''llari kasalliklari', 'j35 surunkali tonzillit хронический тонзиллит chronic tonsillitis'),
('J40', 'Bronxit (o''tkir/surunkali aniqlanmagan)', 'Бронхит неуточнённый', 'Bronchitis, not specified', 'J', 'Nafas yo''llari kasalliklari', 'j40 bronxit бронхит bronchitis'),
('J44.9', 'Surunkali obstruktiv o''pka kasalligi (SOOK)', 'Хроническая обструктивная болезнь лёгких (ХОБЛ)', 'Chronic obstructive pulmonary disease', 'J', 'Nafas yo''llari kasalliklari', 'j44 sook xobl o''pka хобл copd'),
('J45.9', 'Bronxial astma', 'Бронхиальная астма', 'Asthma', 'J', 'Nafas yo''llari kasalliklari', 'j45 astma bronxial астма asthma'),

-- ===== K: Ovqat hazm qilish =====
('K02.9', 'Tish kariyesi', 'Кариес зубов', 'Dental caries', 'K', 'Ovqat hazm qilish kasalliklari', 'k02 karyes tish chirishi кариес caries tooth decay'),
('K04.7', 'Periapikal absess', 'Периапикальный абсцесс', 'Periapical abscess', 'K', 'Ovqat hazm qilish kasalliklari', 'k04 tish absess flyus периапикальный абсцесс tooth abscess'),
('K05.1', 'Surunkali gingivit', 'Хронический гингивит', 'Chronic gingivitis', 'K', 'Ovqat hazm qilish kasalliklari', 'k05 gingivit milk yallig''lanish гингивит gingivitis'),
('K05.3', 'Surunkali periodontit', 'Хронический периодонтит', 'Chronic periodontitis', 'K', 'Ovqat hazm qilish kasalliklari', 'k05 periodontit tish periodontit пародонтит periodontitis'),
('K21.9', 'Gastroezofagal reflyuks (GERK)', 'Гастроэзофагеальный рефлюкс', 'Gastro-oesophageal reflux disease', 'K', 'Ovqat hazm qilish kasalliklari', 'k21 reflyuks gerb izza рефлюкс изжога gerd reflux heartburn'),
('K25.9', 'Oshqozon yarasi', 'Язва желудка', 'Gastric ulcer', 'K', 'Ovqat hazm qilish kasalliklari', 'k25 yara oshqozon язва желудка gastric ulcer'),
('K26.9', 'O''n ikki barmoq ichak yarasi', 'Язва двенадцатиперстной кишки', 'Duodenal ulcer', 'K', 'Ovqat hazm qilish kasalliklari', 'k26 yara duodenal ichak язва двенадцатиперстной duodenal ulcer'),
('K29.7', 'Gastrit, aniqlanmagan', 'Гастрит неуточнённый', 'Gastritis, unspecified', 'K', 'Ovqat hazm qilish kasalliklari', 'k29 gastrit oshqozon yallig''lanish гастрит gastritis'),
('K30', 'Funksional dispepsiya', 'Функциональная диспепсия', 'Functional dyspepsia', 'K', 'Ovqat hazm qilish kasalliklari', 'k30 dispepsiya hazm диспепсия dyspepsia indigestion'),
('K35.8', 'O''tkir appenditsit', 'Острый аппендицит', 'Acute appendicitis', 'K', 'Ovqat hazm qilish kasalliklari', 'k35 appenditsit ko''richak аппендицит appendicitis'),
('K40.9', 'Chov churrasi', 'Паховая грыжа', 'Inguinal hernia', 'K', 'Ovqat hazm qilish kasalliklari', 'k40 churra chov грыжа паховая inguinal hernia'),
('K52.9', 'Gastroenterit va kolit (noinfeksion)', 'Гастроэнтерит и колит неинфекционный', 'Noninfective gastroenteritis and colitis', 'K', 'Ovqat hazm qilish kasalliklari', 'k52 gastroenterit kolit гастроэнтерит gastroenteritis'),
('K58.9', 'Ta''sirlangan ichak sindromi', 'Синдром раздражённого кишечника', 'Irritable bowel syndrome', 'K', 'Ovqat hazm qilish kasalliklari', 'k58 ichak sindrom синдром раздражённого кишечника ibs irritable bowel'),
('K59.0', 'Qabziyat', 'Запор', 'Constipation', 'K', 'Ovqat hazm qilish kasalliklari', 'k59 qabziyat ich qotishi запор constipation'),
('K70.3', 'Jigar sirrozi (alkogolli)', 'Алкогольный цирроз печени', 'Alcoholic cirrhosis of liver', 'K', 'Ovqat hazm qilish kasalliklari', 'k70 sirroz jigar цирроз печени liver cirrhosis'),
('K76.0', 'Jigarning yog''li distrofiyasi', 'Жировая дистрофия печени', 'Fatty liver', 'K', 'Ovqat hazm qilish kasalliklari', 'k76 jigar yog'' gepatoz жировой гепатоз fatty liver'),
('K80.2', 'O''t-tosh kasalligi (xoletsistitsiz)', 'Желчнокаменная болезнь без холецистита', 'Gallstone without cholecystitis', 'K', 'Ovqat hazm qilish kasalliklari', 'k80 o''t tosh желчнокаменная gallstones'),
('K81.9', 'Xoletsistit, aniqlanmagan', 'Холецистит неуточнённый', 'Cholecystitis, unspecified', 'K', 'Ovqat hazm qilish kasalliklari', 'k81 xoletsistit o''t pufak холецистит cholecystitis'),
('K85.9', 'O''tkir pankreatit', 'Острый панкреатит', 'Acute pancreatitis', 'K', 'Ovqat hazm qilish kasalliklari', 'k85 pankreatit oshqozon osti панкреатит pancreatitis'),

-- ===== L: Teri kasalliklari =====
('L20.9', 'Atopik dermatit', 'Атопический дерматит', 'Atopic dermatitis', 'L', 'Teri kasalliklari', 'l20 dermatit ekzema atopik атопический дерматит экзема atopic dermatitis eczema'),
('L23.9', 'Allergik kontakt dermatit', 'Аллергический контактный дерматит', 'Allergic contact dermatitis', 'L', 'Teri kasalliklari', 'l23 dermatit allergiya kontakt аллергический дерматит contact dermatitis'),
('L29.9', 'Qichishish, aniqlanmagan', 'Зуд неуточнённый', 'Pruritus, unspecified', 'L', 'Teri kasalliklari', 'l29 qichishish зуд itching pruritus'),
('L40.9', 'Psoriaz, aniqlanmagan', 'Псориаз неуточнённый', 'Psoriasis, unspecified', 'L', 'Teri kasalliklari', 'l40 psoriaz teri псориаз psoriasis'),
('L50.9', 'Eshakem (krapivnitsa)', 'Крапивница неуточнённая', 'Urticaria, unspecified', 'L', 'Teri kasalliklari', 'l50 eshakem krapivnitsa крапивница urticaria hives'),
('L70.0', 'Oddiy husnbuzar (akne)', 'Угревая болезнь', 'Acne vulgaris', 'L', 'Teri kasalliklari', 'l70 husnbuzar akne ugri угри acne'),
('L02.9', 'Teri absessi, furunkul, karbunkul', 'Абсцесс кожи, фурункул, карбункул', 'Cutaneous abscess, furuncle, carbuncle', 'L', 'Teri kasalliklari', 'l02 chipqon furunkul absess фурункул абсцесс furuncle abscess boil'),

-- ===== M: Suyak-mushak tizimi =====
('M06.9', 'Revmatoid artrit, aniqlanmagan', 'Ревматоидный артрит неуточнённый', 'Rheumatoid arthritis, unspecified', 'M', 'Suyak-mushak kasalliklari', 'm06 revmatoid artrit ревматоидный артрит rheumatoid arthritis'),
('M10.9', 'Podagra, aniqlanmagan', 'Подагра неуточнённая', 'Gout, unspecified', 'M', 'Suyak-mushak kasalliklari', 'm10 podagra подагра gout'),
('M15.9', 'Poliartroz', 'Полиартроз', 'Polyarthrosis', 'M', 'Suyak-mushak kasalliklari', 'm15 poliartroz bo''g''im полиартроз polyarthrosis'),
('M17.9', 'Tizza bo''g''imi artrozi (gonartroz)', 'Артроз коленного сустава', 'Osteoarthritis of knee', 'M', 'Suyak-mushak kasalliklari', 'm17 gonartroz tizza артроз коленного knee osteoarthritis'),
('M19.9', 'Artroz, aniqlanmagan', 'Артроз неуточнённый', 'Osteoarthritis, unspecified', 'M', 'Suyak-mushak kasalliklari', 'm19 artroz bo''g''im артроз osteoarthritis'),
('M25.5', 'Bo''g''im og''rig''i', 'Боль в суставе', 'Pain in joint', 'M', 'Suyak-mushak kasalliklari', 'm25 bo''g''im og''riq боль в суставе joint pain arthralgia'),
('M42.9', 'Umurtqa osteoxondrozi', 'Остеохондроз позвоночника', 'Spinal osteochondrosis', 'M', 'Suyak-mushak kasalliklari', 'm42 osteoxondroz umurtqa остеохондроз osteochondrosis'),
('M51.1', 'Disk churrasi (radikulopatiya bilan)', 'Поражение межпозвоночного диска с радикулопатией', 'Disc disorder with radiculopathy', 'M', 'Suyak-mushak kasalliklari', 'm51 disk churra gryja межпозвоночный диск грыжа disc herniation'),
('M54.5', 'Bel og''rig''i', 'Боль внизу спины', 'Low back pain', 'M', 'Suyak-mushak kasalliklari', 'm54 bel og''riq lumbago боль в спине люмбаго low back pain lumbago'),
('M54.2', 'Bo''yin og''rig''i (servikalgiya)', 'Цервикалгия (боль в шее)', 'Cervicalgia', 'M', 'Suyak-mushak kasalliklari', 'm54 bo''yin og''riq servikalgiya боль в шее neck pain'),
('M75.0', 'Yelka adgeziv kapsuliti', 'Адгезивный капсулит плеча', 'Adhesive capsulitis of shoulder', 'M', 'Suyak-mushak kasalliklari', 'm75 yelka kapsulit плечо frozen shoulder'),
('M79.1', 'Mialgiya (mushak og''rig''i)', 'Миалгия', 'Myalgia', 'M', 'Suyak-mushak kasalliklari', 'm79 mialgiya mushak og''riq миалгия myalgia muscle pain'),
('M81.0', 'Postmenopauzal osteoporoz', 'Постменопаузальный остеопороз', 'Postmenopausal osteoporosis', 'M', 'Suyak-mushak kasalliklari', 'm81 osteoporoz suyak остеопороз osteoporosis'),

-- ===== N: Siydik-tanosil tizimi =====
('N18.9', 'Surunkali buyrak kasalligi', 'Хроническая болезнь почек', 'Chronic kidney disease', 'N', 'Siydik-tanosil kasalliklari', 'n18 buyrak yetishmovchilik surunkali хроническая болезнь почек chronic kidney disease'),
('N20.0', 'Buyrak toshi', 'Камень почки', 'Calculus of kidney', 'N', 'Siydik-tanosil kasalliklari', 'n20 buyrak tosh камень почки kidney stone'),
('N23', 'Buyrak sanchig''i', 'Почечная колика', 'Renal colic', 'N', 'Siydik-tanosil kasalliklari', 'n23 buyrak sanchiq почечная колика renal colic'),
('N30.9', 'Sistit, aniqlanmagan', 'Цистит неуточнённый', 'Cystitis, unspecified', 'N', 'Siydik-tanosil kasalliklari', 'n30 sistit qovuq цистит cystitis bladder infection'),
('N39.0', 'Siydik yo''llari infeksiyasi', 'Инфекция мочевыводящих путей', 'Urinary tract infection', 'N', 'Siydik-tanosil kasalliklari', 'n39 siydik infeksiya инфекция мочевыводящих uti urinary infection'),
('N40', 'Prostata giperplaziyasi (adenoma)', 'Гиперплазия предстательной железы', 'Prostatic hyperplasia', 'N', 'Siydik-tanosil kasalliklari', 'n40 prostata adenoma гиперплазия простаты prostate bph'),
('N41.9', 'Prostatit, aniqlanmagan', 'Простатит неуточнённый', 'Prostatitis, unspecified', 'N', 'Siydik-tanosil kasalliklari', 'n41 prostatit простатит prostatitis'),
('N76.0', 'O''tkir vaginit', 'Острый вагинит', 'Acute vaginitis', 'N', 'Siydik-tanosil kasalliklari', 'n76 vaginit kolpit вагинит кольпит vaginitis'),
('N72', 'Bachadon bo''yni yallig''lanishi', 'Воспаление шейки матки', 'Inflammatory disease of cervix', 'N', 'Siydik-tanosil kasalliklari', 'n72 servitsit bachadon bo''yni цервицит cervicitis'),
('N80.9', 'Endometrioz, aniqlanmagan', 'Эндометриоз неуточнённый', 'Endometriosis, unspecified', 'N', 'Siydik-tanosil kasalliklari', 'n80 endometrioz эндометриоз endometriosis'),
('N91.2', 'Amenoreya, aniqlanmagan', 'Аменорея неуточнённая', 'Amenorrhoea, unspecified', 'N', 'Siydik-tanosil kasalliklari', 'n91 amenoreya hayz аменорея amenorrhea'),
('N92.0', 'Ko''p va tez-tez hayz ko''rish', 'Обильные и частые менструации', 'Excessive and frequent menstruation', 'N', 'Siydik-tanosil kasalliklari', 'n92 menoragiya hayz менструация обильные menorrhagia'),
('N94.6', 'Dismenoreya, aniqlanmagan', 'Дисменорея неуточнённая', 'Dysmenorrhoea, unspecified', 'N', 'Siydik-tanosil kasalliklari', 'n94 dismenoreya hayz og''riq дисменорея dysmenorrhea'),
('N95.1', 'Klimakterik holat (menopauza)', 'Менопауза и климактерическое состояние', 'Menopausal state', 'N', 'Siydik-tanosil kasalliklari', 'n95 klimaks menopauza климакс менопауза menopause'),

-- ===== O: Homiladorlik, tug'ish =====
('O21.9', 'Homiladorlar qusishi', 'Рвота беременных', 'Vomiting of pregnancy', 'O', 'Homiladorlik va tug''ish', 'o21 homiladorlik qusish токсикоз рвота беременных pregnancy vomiting'),
('O23.9', 'Homiladorlikda siydik yo''llari infeksiyasi', 'Инфекция мочеполовых путей при беременности', 'Genitourinary tract infection in pregnancy', 'O', 'Homiladorlik va tug''ish', 'o23 homiladorlik infeksiya беременность инфекция pregnancy infection'),
('O26.8', 'Homiladorlik bilan bog''liq holat', 'Состояние, связанное с беременностью', 'Pregnancy-related condition', 'O', 'Homiladorlik va tug''ish', 'o26 homiladorlik беременность pregnancy'),
('Z34.9', 'Normal homiladorlik kuzatuvi', 'Наблюдение за нормальной беременностью', 'Supervision of normal pregnancy', 'Z', 'Homiladorlik va tug''ish', 'z34 homiladorlik kuzatuv беременность наблюдение pregnancy supervision'),

-- ===== P: Perinatal holatlar =====
('P07.3', 'Muddatidan oldin tug''ilgan chaqaloq', 'Недоношенный новорождённый', 'Preterm newborn', 'P', 'Perinatal holatlar', 'p07 chala tug''ilgan недоношенный preterm premature'),
('P59.9', 'Yangi tug''ilganlar sariqligi', 'Желтуха новорождённых', 'Neonatal jaundice', 'P', 'Perinatal holatlar', 'p59 sariqlik chaqaloq желтуха новорождённых neonatal jaundice'),

-- ===== Q: Tug'ma anomaliyalar =====
('Q21.0', 'Qorincha devori nuqsoni', 'Дефект межжелудочковой перегородки', 'Ventricular septal defect', 'Q', 'Tug''ma anomaliyalar', 'q21 yurak nuqson дефект перегородки vsd septal defect'),
('Q53.9', 'Tushmagan moyak (kriptorxizm)', 'Неопустившееся яичко', 'Undescended testicle', 'Q', 'Tug''ma anomaliyalar', 'q53 kriptorxizm moyak крипторхизм undescended testicle'),

-- ===== R: Simptomlar va belgilar =====
('R05', 'Yo''tal', 'Кашель', 'Cough', 'R', 'Simptom va belgilar', 'r05 yo''tal кашель cough'),
('R07.4', 'Ko''krak og''rig''i, aniqlanmagan', 'Боль в груди неуточнённая', 'Chest pain, unspecified', 'R', 'Simptom va belgilar', 'r07 ko''krak og''riq боль в груди chest pain'),
('R10.4', 'Qorin og''rig''i, aniqlanmagan', 'Боль в животе неуточнённая', 'Abdominal pain, unspecified', 'R', 'Simptom va belgilar', 'r10 qorin og''riq боль в животе abdominal pain stomach ache'),
('R11', 'Ko''ngil aynishi va qusish', 'Тошнота и рвота', 'Nausea and vomiting', 'R', 'Simptom va belgilar', 'r11 ko''ngil aynish qusish тошнота рвота nausea vomiting'),
('R42', 'Bosh aylanishi', 'Головокружение', 'Dizziness and giddiness', 'R', 'Simptom va belgilar', 'r42 bosh aylanish головокружение dizziness vertigo'),
('R50.9', 'Isitma, aniqlanmagan', 'Лихорадка неуточнённая', 'Fever, unspecified', 'R', 'Simptom va belgilar', 'r50 isitma harorat лихорадка температура fever'),
('R51', 'Bosh og''rig''i', 'Головная боль', 'Headache', 'R', 'Simptom va belgilar', 'r51 bosh og''riq головная боль headache'),
('R53', 'Holsizlik va charchoq', 'Недомогание и утомляемость', 'Malaise and fatigue', 'R', 'Simptom va belgilar', 'r53 holsizlik charchoq слабость утомляемость malaise fatigue weakness'),
('R60.9', 'Shish (o''sma), aniqlanmagan', 'Отёк неуточнённый', 'Oedema, unspecified', 'R', 'Simptom va belgilar', 'r60 shish отёк oedema swelling'),

-- ===== S-T: Jarohatlar =====
('S06.0', 'Miya chayqalishi', 'Сотрясение головного мозга', 'Concussion', 'S', 'Jarohatlar', 's06 miya chayqalish сотрясение concussion'),
('S52.5', 'Bilak suyagi sinishi (pastki uchi)', 'Перелом нижнего конца лучевой кости', 'Fracture of lower end of radius', 'S', 'Jarohatlar', 's52 sinish bilak перелом fracture radius'),
('S72.0', 'Son suyagi bo''yni sinishi', 'Перелом шейки бедренной кости', 'Fracture of neck of femur', 'S', 'Jarohatlar', 's72 sinish son perelom перелом бедра hip fracture'),
('S93.4', 'To''piq boylamlari cho''zilishi', 'Растяжение связок голеностопа', 'Sprain of ankle', 'S', 'Jarohatlar', 's93 to''piq cho''zilish растяжение ankle sprain'),
('T14.9', 'Jarohat, aniqlanmagan', 'Травма неуточнённая', 'Injury, unspecified', 'T', 'Jarohatlar', 't14 jarohat travma травма injury'),
('T78.4', 'Allergiya, aniqlanmagan', 'Аллергия неуточнённая', 'Allergy, unspecified', 'T', 'Jarohatlar', 't78 allergiya аллергия allergy'),

-- ===== Z: Profilaktik tekshiruvlar =====
('Z00.0', 'Umumiy tibbiy ko''rik', 'Общий медицинский осмотр', 'General medical examination', 'Z', 'Profilaktik tekshiruvlar', 'z00 ko''rik tekshiruv profilaktika медосмотр осмотр checkup examination'),
('Z01.7', 'Laboratoriya tekshiruvi', 'Лабораторное исследование', 'Laboratory examination', 'Z', 'Profilaktik tekshiruvlar', 'z01 laboratoriya tahlil лабораторное анализ lab examination'),
('Z23', 'Emlash uchun murojaat', 'Обращение для иммунизации', 'Immunization', 'Z', 'Profilaktik tekshiruvlar', 'z23 emlash vaksina иммунизация прививка vaccination immunization'),
('Z76.0', 'Retsept yangilash', 'Выписка повторного рецепта', 'Issue of repeat prescription', 'Z', 'Profilaktik tekshiruvlar', 'z76 retsept рецепт prescription')

ON CONFLICT (code) DO UPDATE SET
  name_uz = EXCLUDED.name_uz,
  name_ru = EXCLUDED.name_ru,
  name_en = EXCLUDED.name_en,
  search_text = EXCLUDED.search_text;
