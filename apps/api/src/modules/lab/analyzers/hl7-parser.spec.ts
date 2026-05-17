import { describe, it, expect } from 'vitest';

import { GenericHl7Adapter } from './analyzer-adapter';
import { hl7TimeToIso, parseHl7Message } from './hl7-parser';

// Realistik ORU^R01 lab natija xabari (Mindray uslubidagi)
const SAMPLE_ORU = [
  'MSH|^~\\&|ANALYZER|LAB|LIS|CLINIC|20260524081500||ORU^R01|MSG00001|P|2.5',
  'PID|1||P12345^^^CLINIC||DOE^JOHN',
  'OBR|1|ORD-9001|LAB-26-000042|CBC^Complete Blood Count',
  'OBX|1|NM|718-7^Hemoglobin^LN||13.5|g/dL|13.0 - 17.0|N|||F|||20260524081500',
  'OBX|2|NM|6690-2^Leukocytes^LN||3.1|10*3/uL|4.0 - 11.0|L|||F|||20260524081500',
  'OBX|3|ST|free-text^Comment^L||Sample slightly hemolyzed',
].join('\r');

describe('parseHl7Message', () => {
  it('splits segments and reads delimiters from MSH', () => {
    const { segments, delimiters } = parseHl7Message(SAMPLE_ORU);
    expect(segments).toHaveLength(6);
    expect(segments[0]?.name).toBe('MSH');
    expect(delimiters.field).toBe('|');
    expect(delimiters.component).toBe('^');
  });

  it('handles \\n line endings too', () => {
    const { segments } = parseHl7Message(SAMPLE_ORU.replace(/\r/g, '\n'));
    expect(segments).toHaveLength(6);
  });
});

describe('hl7TimeToIso', () => {
  it('converts a full HL7 timestamp to ISO', () => {
    expect(hl7TimeToIso('20260524081500')).toBe('2026-05-24T08:15:00.000Z');
  });
  it('handles date-only timestamps', () => {
    expect(hl7TimeToIso('20260524')).toBe('2026-05-24T00:00:00.000Z');
  });
  it('returns null for garbage', () => {
    expect(hl7TimeToIso('not-a-date')).toBeNull();
    expect(hl7TimeToIso(undefined)).toBeNull();
  });
});

describe('GenericHl7Adapter', () => {
  const adapter = new GenericHl7Adapter();

  it('parses OBX result segments from an ORU message', () => {
    const out = adapter.parse(SAMPLE_ORU);
    expect(out.ok).toBe(true);
    expect(out.results).toHaveLength(3);

    const hgb = out.results[0]!;
    expect(hgb.loincCode).toBe('718-7');
    expect(hgb.testName).toBe('Hemoglobin');
    expect(hgb.numericValue).toBe(13.5);
    expect(hgb.unit).toBe('g/dL');
    expect(hgb.referenceRange).toBe('13.0 - 17.0');
    expect(hgb.measuredAt).toBe('2026-05-24T08:15:00.000Z');
  });

  it('extracts the sample barcode from OBR-3', () => {
    const out = adapter.parse(SAMPLE_ORU);
    expect(out.results[0]?.sampleBarcode).toBe('LAB-26-000042');
  });

  it('keeps text results as value with null numericValue', () => {
    const out = adapter.parse(SAMPLE_ORU);
    const comment = out.results[2]!;
    expect(comment.numericValue).toBeNull();
    expect(comment.value).toBe('Sample slightly hemolyzed');
    // Kod tizimi 'L' (LOINC emas) — loincCode null
    expect(comment.loincCode).toBeNull();
  });

  it('fails cleanly on an empty payload', () => {
    expect(adapter.parse('').ok).toBe(false);
    expect(adapter.parse('   ').ok).toBe(false);
  });

  it('fails when there is no MSH segment', () => {
    const out = adapter.parse('OBX|1|NM|718-7^Hgb^LN||13|g/dL');
    expect(out.ok).toBe(false);
    expect(out.error).toContain('MSH');
  });

  it('fails when there are no OBX segments', () => {
    const out = adapter.parse('MSH|^~\\&|A|L|LIS|C|20260524||ORU^R01|1|P|2.5\rPID|1');
    expect(out.ok).toBe(false);
    expect(out.error).toContain('OBX');
  });
});
