import {
  blank,
  esc,
  renderA4Blank,
  type BlankSettings,
  type ClinicInfo,
  type PatientInfo,
} from './a4-blank';
import { printA4Document } from './print-receipt';

// =============================================================================
// Tashxis shabloni — A4 hujjat (oldindan ko'rish + chop etish)
// =============================================================================
// Sarlavha, bemor bloki, imzo/muhr va kolontitul UMUMIY blankadan keladi
// (a4-blank.ts). Bu fayl faqat hujjatning o'ziga xos qismini — tashxis va
// SOAP bo'limlarini — yasaydi.

export interface TemplateDoc {
  name: string;
  diagnosis_code?: string | null;
  diagnosis_text?: string | null;
  soap_subjective?: string | null;
  soap_objective?: string | null;
  soap_assessment?: string | null;
  soap_plan?: string | null;
}

export interface TemplateDocMeta {
  clinic: ClinicInfo;
  settings?: BlankSettings;
  doctorName?: string | null;
  /** Berilsa hujjat to'ldirilgan holatda chiqadi (namuna yoki haqiqiy bemor). */
  patient?: PatientInfo;
}

function section(title: string, body?: string | null): string {
  const text = (body ?? '').trim();
  return `
    <div style="margin-top:12px">
      <div style="font-weight:600;font-size:12px;margin-bottom:3px">${esc(title)}</div>
      <div style="white-space:pre-wrap;line-height:1.5;min-height:18px">${
        text ? esc(text) : blank(46)
      }</div>
    </div>`;
}

function templateBody(t: TemplateDoc): string {
  const dx = [t.diagnosis_code, t.diagnosis_text].filter(Boolean).join(' — ');
  return `
    <div style="margin-top:6px">
      <div style="font-weight:600;font-size:12px;margin-bottom:3px">Tashxis (ICD-10)</div>
      <div style="line-height:1.5">${dx ? esc(dx) : blank(46)}</div>
    </div>
    ${section('S — Shikoyat (subyektiv)', t.soap_subjective)}
    ${section("O — Obyektiv ko'rik", t.soap_objective)}
    ${section('A — Baho', t.soap_assessment)}
    ${section('P — Reja', t.soap_plan)}
  `;
}

/** Shablonning to'liq A4 tanasi. */
export function templateA4Html(t: TemplateDoc, meta: TemplateDocMeta): string {
  return renderA4Blank({
    title: 'Tibbiy xulosa',
    clinic: meta.clinic,
    settings: meta.settings,
    patient: meta.patient,
    doctorName: meta.doctorName,
    body: templateBody(t),
    note: `Shablon: ${t.name}`,
  });
}

/** Shablonni chop etish — desktop'da silent, brauzerda dialog bilan. */
export function printTemplate(t: TemplateDoc, meta: TemplateDocMeta): void {
  printA4Document(templateA4Html(t, meta), `Shablon — ${t.name}`);
}

// Eski import yo'lini buzmaslik uchun qayta eksport.
export { A4_PREVIEW_CSS } from './a4-blank';
