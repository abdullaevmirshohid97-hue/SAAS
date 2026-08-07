import { describe, expect, it } from 'vitest';

import {
  buildLabResultPdf,
  labPatientName,
  labTestName,
  pickReferenceRange,
  referenceGroupLabel,
  type LabTestRef,
} from './lab-result-pdf';

const test = (over: Partial<NonNullable<LabTestRef>> = {}): LabTestRef => ({
  reference_range_male: '4.0–5.5',
  reference_range_female: '3.9–4.9',
  reference_range_child: '3.5–4.5',
  ...over,
});

// Bola yoshi hisobi "hozir"ga bog'liq — sanani shunga qarab yasaymiz.
const dobYearsAgo = (years: number) =>
  new Date(Date.now() - years * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10);

// ── pickReferenceRange ───────────────────────────────────────────────────────
// Bu mantiq patient.clary.uz/r/<token> sahifasi bilan AYNAN bir xil bo'lishi
// shart: bemor QR orqali PDF'dagidan boshqa normani ko'rsa, klinikaga bo'lgan
// ishonch yo'qoladi.
describe('pickReferenceRange', () => {
  it('18 yoshgacha — bola normasi', () => {
    expect(pickReferenceRange(test(), { dob: dobYearsAgo(10), gender: 'male' })).toBe('3.5–4.5');
  });

  it('18 yoshdan katta erkak — erkak normasi', () => {
    expect(pickReferenceRange(test(), { dob: dobYearsAgo(30), gender: 'male' })).toBe('4.0–5.5');
  });

  it('18 yoshdan katta ayol — ayol normasi', () => {
    expect(pickReferenceRange(test(), { dob: dobYearsAgo(30), gender: 'female' })).toBe('3.9–4.9');
  });

  it('bola normasi yo‘q bo‘lsa jins normasiga tushadi', () => {
    expect(
      pickReferenceRange(test({ reference_range_child: null }), {
        dob: dobYearsAgo(10),
        gender: 'female',
      }),
    ).toBe('3.9–4.9');
  });

  it('ayol normasi yo‘q bo‘lsa erkaknikiga tushadi', () => {
    expect(
      pickReferenceRange(test({ reference_range_female: null }), {
        dob: dobYearsAgo(30),
        gender: 'female',
      }),
    ).toBe('4.0–5.5');
  });

  it('tug‘ilgan sana yo‘q — katta deb hisoblanadi (bola normasi qo‘llanmaydi)', () => {
    expect(pickReferenceRange(test(), { dob: null, gender: 'male' })).toBe('4.0–5.5');
  });

  it('test yo‘q — chiziqcha', () => {
    expect(pickReferenceRange(null, { dob: dobYearsAgo(30) })).toBe('—');
  });

  it('hech qanday norma yo‘q — chiziqcha', () => {
    expect(
      pickReferenceRange(
        {
          reference_range_male: null,
          reference_range_female: null,
          reference_range_child: null,
        },
        { dob: dobYearsAgo(30), gender: 'male' },
      ),
    ).toBe('—');
  });
});

describe('referenceGroupLabel', () => {
  it('bola / ayol / erkak', () => {
    expect(referenceGroupLabel({ dob: dobYearsAgo(5) })).toBe('bola');
    expect(referenceGroupLabel({ dob: dobYearsAgo(40), gender: 'female' })).toBe('ayol');
    expect(referenceGroupLabel({ dob: dobYearsAgo(40), gender: 'male' })).toBe('erkak');
  });

  it('noma’lum jins va sana — chiziqcha', () => {
    expect(referenceGroupLabel({})).toBe('—');
  });
});

// ── labPatientName ───────────────────────────────────────────────────────────
describe('labPatientName', () => {
  it('familiya + ism + otasining ismi ustuvor', () => {
    expect(
      labPatientName({
        full_name: 'ESKI NOM',
        last_name: 'Valiyev',
        first_name: 'Ali',
        patronymic: 'Aliyevich',
      }),
    ).toBe('Valiyev Ali Aliyevich');
  });

  it('bo‘laklar yo‘q bo‘lsa full_name', () => {
    expect(labPatientName({ full_name: 'Ali Valiyev' })).toBe('Ali Valiyev');
  });

  it('hech narsa yo‘q — chiziqcha', () => {
    expect(labPatientName(null)).toBe('—');
    expect(labPatientName({})).toBe('—');
  });
});

// ── labTestName ──────────────────────────────────────────────────────────────
describe('labTestName', () => {
  it('snapshot ustuvor (buyurtma paytidagi nom)', () => {
    expect(
      labTestName({ name_snapshot: 'Gemoglobin', test: { name_i18n: { 'uz-Latn': 'Boshqa' } } }),
    ).toBe('Gemoglobin');
  });

  it('snapshot yo‘q — i18n tartibi uz-Latn → uz → ru', () => {
    expect(labTestName({ test: { name_i18n: { ru: 'Гемоглобин' } } })).toBe('Гемоглобин');
    expect(
      labTestName({ test: { name_i18n: { 'uz-Latn': 'Gemoglobin', ru: 'Гемоглобин' } } }),
    ).toBe('Gemoglobin');
  });

  it('hech narsa yo‘q — "tahlil"', () => {
    expect(labTestName({})).toBe('tahlil');
  });
});

// ── PDF haqiqatan yasaladimi ────────────────────────────────────────────────
// Ilgari prod'da shrift topilmay PDF 500 bergan (report-pdf resolveFontDir).
// Bu test shu yo'lni ham, kirill/o'zbek belgilarini ham qamrab oladi.
describe('buildLabResultPdf', () => {
  const order = {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    created_at: '2026-08-07T05:00:00Z',
    reported_at: '2026-08-07T07:30:00Z',
    public_token: '11111111-2222-3333-4444-555555555555',
    clinical_notes: 'Ochlik qorniga topshirilgan',
    patient: {
      last_name: 'Валиев',
      first_name: 'Али',
      patronymic: 'Аliyevich',
      dob: '1990-05-01',
      gender: 'male',
    },
    items: [
      {
        name_snapshot: 'Gemoglobin',
        test: { unit: 'g/L', reference_range_male: '130–160', reference_range_female: '120–150' },
        results: [{ value: '145', unit: 'g/L', is_abnormal: false, is_final: true }],
      },
      {
        name_snapshot: 'Лейкоциты',
        test: { unit: '10^9/L', reference_range_male: '4.0–9.0' },
        results: [{ value: '12.4', unit: '10^9/L', is_abnormal: true, is_final: true }],
      },
    ],
  };

  it('haqiqiy PDF buferi qaytaradi', async () => {
    const buf = await buildLabResultPdf(order, 'MAGNUS', 'https://patient.clary.uz');
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('natijasiz buyurtmada ham yiqilmaydi', async () => {
    const buf = await buildLabResultPdf(
      { id: order.id, patient: order.patient, items: [] },
      'MAGNUS',
      null,
    );
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
