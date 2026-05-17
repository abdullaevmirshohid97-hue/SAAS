import { describe, it, expect } from 'vitest';

import { toFhirObservation, type LabResultForFhir } from './fhir-mapper';

const base: LabResultForFhir = {
  id: 'r1',
  loinc_code: '2345-7',
  value: '95',
  numeric_value: 95,
  unit: 'mg/dL',
  reference_range: '70 - 110',
  flag: 'normal',
  reported_at: '2026-05-24T08:00:00.000Z',
  validation_status: 'validated',
};

describe('toFhirObservation', () => {
  it('maps a validated numeric result to a final Observation', () => {
    const obs = toFhirObservation(base);
    expect(obs.resourceType).toBe('Observation');
    expect(obs.status).toBe('final');
    expect(obs.code.coding[0]).toEqual({ system: 'http://loinc.org', code: '2345-7' });
    expect(obs.valueQuantity).toEqual({ value: 95, unit: 'mg/dL' });
    expect(obs.effectiveDateTime).toBe('2026-05-24T08:00:00.000Z');
  });

  it('uses preliminary status for draft results', () => {
    expect(toFhirObservation({ ...base, validation_status: 'draft' }).status).toBe(
      'preliminary',
    );
  });

  it('uses cancelled status for rejected results', () => {
    expect(toFhirObservation({ ...base, validation_status: 'rejected' }).status).toBe(
      'cancelled',
    );
  });

  it('falls back to valueString when no numeric value/unit', () => {
    const obs = toFhirObservation({
      ...base,
      numeric_value: null,
      unit: null,
      value: 'Positive',
    });
    expect(obs.valueString).toBe('Positive');
    expect(obs.valueQuantity).toBeUndefined();
  });

  it('maps critical_high flag to HH interpretation', () => {
    const obs = toFhirObservation({ ...base, flag: 'critical_high' });
    expect(obs.interpretation?.[0]?.coding[0]?.code).toBe('HH');
  });

  it('handles a missing LOINC code with a fallback coding', () => {
    const obs = toFhirObservation({ ...base, loinc_code: null });
    expect(obs.code.coding[0]?.system).toBe('urn:clary:lab');
  });
});
