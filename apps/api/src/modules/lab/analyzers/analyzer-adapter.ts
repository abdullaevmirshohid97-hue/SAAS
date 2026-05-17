// =============================================================================
// FAZA 4 — Analizator adapter qatlami (KELAJAK SKELETI)
// =============================================================================
// Bu fayl ishlaydigan integratsiya EMAS. Bu — kelajakda laboratoriya
// analizatorlari (Mindray, Roche, Abbott, Sysmex) bilan ulanish uchun toza
// interfeys. Har bir apparat o'z protokoliga ega (HL7 v2, ASTM E1394), shuning
// uchun har biri uchun alohida adapter yoziladi, lekin hammasi shu interfeysga
// bo'ysunadi.
//
// Ulanish modeli (kelajakda):
//   analizator → TCP/serial → adapter.parse() → AnalyzerResult[] → lab_results
//
// Hozircha: faqat shakl. Implementatsiya alohida loyiha sifatida qilinadi.

/** Bitta analizator natijasi — adapter xom xabarni shu ko'rinishga keltiradi. */
export interface AnalyzerResult {
  /** Probirka/namuna identifikatori (barcode) — lab_samples.barcode bilan mos. */
  sampleBarcode: string;
  /** LOINC kodi — loinc_tests bilan bog'lash uchun. */
  loincCode: string | null;
  /** Analizator bergan test nomi (LOINC topilmasa zaxira). */
  testName: string;
  /** Raqamli qiymat (agar son bo'lsa). */
  numericValue: number | null;
  /** Asl matn qiymati. */
  value: string;
  /** O'lchov birligi. */
  unit: string | null;
  /** Referens diapazon (agar apparat bersa). */
  referenceRange: string | null;
  /** Apparat o'lchagan vaqt. */
  measuredAt: string | null;
}

/** Adapter parse natijasi. */
export interface AnalyzerParseOutcome {
  ok: boolean;
  results: AnalyzerResult[];
  /** Xato bo'lsa — sabab (analyzer_logs.error_message ga yoziladi). */
  error?: string;
}

/**
 * Har bir analizator adapteri shu interfeysni amalga oshiradi.
 * Adapter faqat XOM XABARNI PARSE QILADI — DB yozish lab moduli zimmasida,
 * shunda RLS/tenant izolyatsiyasi adapter qatlamidan tashqarida qoladi.
 */
export interface AnalyzerAdapter {
  /** Apparat identifikatori — analyzer_logs.analyzer ga yoziladi. */
  readonly analyzerKey: string;
  /** Qo'llab-quvvatlanadigan protokol. */
  readonly protocol: 'hl7' | 'astm' | 'fhir' | 'proprietary';
  /** Xom xabarni AnalyzerResult ro'yxatiga aylantiradi. */
  parse(rawPayload: string): AnalyzerParseOutcome;
}

/**
 * Generik HL7 v2 adapter SKELETI — kelajakda OBX segmentlarini parse qiladi.
 * Hozir parse qilmaydi, faqat shaklni ko'rsatadi. Haqiqiy implementatsiya:
 * MSH/PID/OBR/OBX segmentlarini ajratish, OBX-3 dan LOINC, OBX-5 dan qiymat.
 */
export class GenericHl7Adapter implements AnalyzerAdapter {
  readonly analyzerKey = 'generic_hl7';
  readonly protocol = 'hl7' as const;

  parse(_rawPayload: string): AnalyzerParseOutcome {
    // TODO(FAZA 4+): HL7 v2 OBX segmentlarini parse qilish.
    // Hozircha integratsiya yo'q — bo'sh, xatosiz natija qaytaramiz.
    return {
      ok: false,
      results: [],
      error: 'HL7 adapter hali amalga oshirilmagan (kelajak skeleti)',
    };
  }
}
