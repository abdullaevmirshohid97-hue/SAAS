// =============================================================================
// FAZA 4 — HL7 FHIR map qatlami (LIS integratsiyasiga tayyor)
// =============================================================================
// lab_results yozuvini FHIR R4 `Observation` resursiga aylantiruvchi sof
// funksiya. Tashqi LIS/EHR tizimlar yoki davlat sog'liqni saqlash platformasi
// bilan integratsiyada ishlatiladi. Sof funksiya — DB ga tegmaydi, test qilish
// oson.

/** lab_results dan kerakli maydonlar (FHIR map kirishi). */
export interface LabResultForFhir {
  id: string;
  loinc_code: string | null;
  value: string;
  numeric_value: number | null;
  unit: string | null;
  reference_range: string | null;
  flag: string | null;
  reported_at: string | null;
  validation_status: string;
}

/** FHIR Observation resursi (soddalashtirilgan R4 shakli). */
export interface FhirObservation {
  resourceType: 'Observation';
  id: string;
  status: 'final' | 'preliminary' | 'cancelled';
  code: {
    coding: Array<{ system: string; code: string; display?: string }>;
  };
  valueQuantity?: { value: number; unit: string };
  valueString?: string;
  interpretation?: Array<{
    coding: Array<{ system: string; code: string }>;
  }>;
  referenceRange?: Array<{ text: string }>;
  effectiveDateTime?: string;
}

const LOINC_SYSTEM = 'http://loinc.org';
const INTERPRETATION_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation';

// lab_results.flag → FHIR interpretation kodi (HL7 v3 ObservationInterpretation)
const FLAG_TO_FHIR: Record<string, string> = {
  normal: 'N',
  low: 'L',
  high: 'H',
  critical_low: 'LL',
  critical_high: 'HH',
};

/**
 * lab_results yozuvini FHIR Observation resursiga aylantiradi.
 * validation_status='validated' bo'lsa status='final', aks holda 'preliminary'.
 */
export function toFhirObservation(r: LabResultForFhir): FhirObservation {
  const obs: FhirObservation = {
    resourceType: 'Observation',
    id: r.id,
    status:
      r.validation_status === 'validated'
        ? 'final'
        : r.validation_status === 'rejected'
          ? 'cancelled'
          : 'preliminary',
    code: {
      coding: r.loinc_code
        ? [{ system: LOINC_SYSTEM, code: r.loinc_code }]
        : [{ system: 'urn:clary:lab', code: 'unknown' }],
    },
  };

  if (r.numeric_value !== null && r.unit) {
    obs.valueQuantity = { value: r.numeric_value, unit: r.unit };
  } else {
    obs.valueString = r.value;
  }

  const fhirInterp = r.flag ? FLAG_TO_FHIR[r.flag] : undefined;
  if (fhirInterp) {
    obs.interpretation = [
      { coding: [{ system: INTERPRETATION_SYSTEM, code: fhirInterp }] },
    ];
  }

  if (r.reference_range) {
    obs.referenceRange = [{ text: r.reference_range }];
  }

  if (r.reported_at) {
    obs.effectiveDateTime = r.reported_at;
  }

  return obs;
}
