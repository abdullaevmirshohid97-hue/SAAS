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
// Retsept — A4 hujjat
// =============================================================================
// Sarlavha, bemor bloki, imzo/muhr va kolontitul UMUMIY blankadan keladi
// (a4-blank.ts), ya'ni Sozlamalar > Blanka'dagi bitta sozlama tashxis
// xulosasiga ham, retseptga ham bir xil qo'llanadi.

export interface RxItem {
  medication_name_snapshot: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  quantity?: number;
  schedule_times?: string[];
  days_count?: number;
}

export interface RxDoc {
  diagnosis_code?: string | null;
  diagnosis_text?: string | null;
  instructions?: string | null;
  items: RxItem[];
}

export interface RxMeta {
  clinic: ClinicInfo;
  settings?: BlankSettings;
  doctorName?: string | null;
  patient?: PatientInfo;
}

function itemsTable(items: RxItem[]): string {
  if (items.length === 0) {
    return `<div style="margin-top:10px">${blank(60)}</div>`;
  }
  const rows = items
    .map((it, i) => {
      const schedule =
        it.schedule_times && it.schedule_times.length > 0
          ? `${it.schedule_times.join(', ')}${it.days_count ? ` · ${it.days_count} kun` : ''}`
          : [it.frequency, it.duration].filter(Boolean).join(' · ');
      return `<tr>
        <td style="width:24px">${i + 1}</td>
        <td><b>${esc(it.medication_name_snapshot)}</b>${
          it.dosage ? `<div class="small muted">${esc(it.dosage)}</div>` : ''
        }</td>
        <td>${esc(schedule || '—')}</td>
        <td class="r">${it.quantity ?? ''}</td>
      </tr>`;
    })
    .join('');
  return `
    <table style="margin-top:8px">
      <thead>
        <tr><th style="width:24px">№</th><th>Dori</th><th>Qabul tartibi</th><th class="r">Miqdor</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function rxBody(rx: RxDoc): string {
  const dx = [rx.diagnosis_code, rx.diagnosis_text].filter(Boolean).join(' — ');
  return `
    <div style="margin-top:6px">
      <div style="font-weight:600;font-size:12px;margin-bottom:3px">Tashxis (ICD-10)</div>
      <div style="line-height:1.5">${dx ? esc(dx) : blank(46)}</div>
    </div>
    <div style="margin-top:12px">
      <div style="font-weight:600;font-size:12px">Rp. — tayinlangan dorilar</div>
      ${itemsTable(rx.items)}
    </div>
    <div style="margin-top:12px">
      <div style="font-weight:600;font-size:12px;margin-bottom:3px">Ko'rsatmalar</div>
      <div style="white-space:pre-wrap;line-height:1.5">${
        rx.instructions?.trim() ? esc(rx.instructions) : blank(46)
      }</div>
    </div>`;
}

export function prescriptionA4Html(rx: RxDoc, meta: RxMeta): string {
  return renderA4Blank({
    title: 'Retsept',
    clinic: meta.clinic,
    settings: meta.settings,
    patient: meta.patient,
    doctorName: meta.doctorName,
    body: rxBody(rx),
  });
}

export function printPrescription(rx: RxDoc, meta: RxMeta): void {
  printA4Document(prescriptionA4Html(rx, meta), 'Retsept');
}
