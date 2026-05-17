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
// HL7 v2 parsing — hl7-parser.ts da. GenericHl7Adapter ishlaydigan parser.

import {
  hl7Component,
  hl7TimeToIso,
  isNumericValueType,
  parseHl7Message,
  type Hl7Delimiters,
  type Hl7Segment,
} from './hl7-parser';

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
 * Generik HL7 v2 adapter — ORU^R01 (Observation Result) xabaridan laborator
 * natijalarni ajratadi. OBX segmentlari natija, OBR/SPM dan probirka barkodi.
 *
 * OBX maydonlari (HL7 standart):
 *   OBX-2  qiymat tipi (NM/SN = raqamli, ST/TX = matn)
 *   OBX-3  test identifikatori — komponent 1 = kod, komponent 3 = kod tizimi.
 *          Kod tizimi 'LN' (LOINC) bo'lsa kod LOINC sifatida olinadi.
 *   OBX-5  kuzatuv qiymati
 *   OBX-6  o'lchov birligi
 *   OBX-7  referens diapazon
 *   OBX-14 kuzatuv vaqti
 */
export class GenericHl7Adapter implements AnalyzerAdapter {
  readonly analyzerKey = 'generic_hl7';
  readonly protocol = 'hl7' as const;

  parse(rawPayload: string): AnalyzerParseOutcome {
    if (!rawPayload || !rawPayload.trim()) {
      return { ok: false, results: [], error: 'Bo‘sh HL7 xabar' };
    }

    let segments: Hl7Segment[];
    let delimiters: Hl7Delimiters;
    try {
      const parsed = parseHl7Message(rawPayload);
      segments = parsed.segments;
      delimiters = parsed.delimiters;
    } catch (err) {
      return {
        ok: false,
        results: [],
        error: `HL7 parse xatosi: ${(err as Error).message}`,
      };
    }

    if (!segments.some((s) => s.name === 'MSH')) {
      return { ok: false, results: [], error: 'MSH segmenti topilmadi' };
    }

    // Probirka barkodi — birinchi OBR-3 (filler order) yoki SPM-2 dan.
    const obr = segments.find((s) => s.name === 'OBR');
    const spm = segments.find((s) => s.name === 'SPM');
    const sampleBarcode =
      hl7Component(spm?.fields[2], 1, delimiters) ||
      hl7Component(obr?.fields[3], 1, delimiters) ||
      hl7Component(obr?.fields[2], 1, delimiters) ||
      '';

    const results: AnalyzerResult[] = [];
    for (const seg of segments) {
      if (seg.name !== 'OBX') continue;
      const valueType = seg.fields[2] ?? '';
      const obx3 = seg.fields[3];
      const codeSystem = hl7Component(obx3, 3, delimiters).toUpperCase();
      const code = hl7Component(obx3, 1, delimiters);
      const testName =
        hl7Component(obx3, 2, delimiters) || code || 'Unknown';
      const rawValue = (seg.fields[5] ?? '').trim();
      const unit = hl7Component(seg.fields[6], 1, delimiters) || null;
      const refRange = (seg.fields[7] ?? '').trim() || null;
      const measuredAt = hl7TimeToIso(seg.fields[14]);

      const numericValue =
        isNumericValueType(valueType) && Number.isFinite(Number(rawValue))
          ? Number(rawValue)
          : null;

      results.push({
        sampleBarcode,
        // LOINC kod tizimi 'LN' bo'lsa kodni LOINC deb olamiz
        loincCode: codeSystem === 'LN' && code ? code : null,
        testName,
        numericValue,
        value: rawValue,
        unit,
        referenceRange: refRange,
        measuredAt,
      });
    }

    if (results.length === 0) {
      return { ok: false, results: [], error: 'OBX (natija) segmenti yo‘q' };
    }
    return { ok: true, results };
  }
}
