// =============================================================================
// ROZILIK HUJJATI — A4 chop etish
// =============================================================================
// Matn serverda RENDER QILINGAN holda keladi (body_snapshot) — placeholder'lar
// allaqachon to'ldirilgan. Bu yerda faqat A4 qog'ozga o'raymiz.
//
// MUHIM: chop etilgan qog'oz = bazadagi `body_snapshot`, aynan bir xil. Shu
// sabab bu yerda matnga HECH QANDAY qo'shimcha kiritilmaydi — imzo joyi ham
// shablonning o'z ichida (klinika uni tahrirlashi mumkin).
// =============================================================================

import type { PatientConsent } from '@clary/api-client';

import { printA4Document } from './print-receipt';

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function fmtDate(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('uz-UZ');
}

/** Rozilik hujjatining A4 HTML'i (chop etish va oldindan ko'rish uchun). */
export function consentA4Html(c: PatientConsent, clinicName: string): string {
  const patient = c.patient?.full_name ?? '';
  return `
    <div class="head">
      <div>
        <h1>${esc(c.title_snapshot)}</h1>
        <div class="muted small">${esc(clinicName)}</div>
      </div>
      <div class="right small muted">
        <div>№ ${esc(c.id.slice(0, 8).toUpperCase())}</div>
        <div>${esc(fmtDate(c.created_at))}</div>
      </div>
    </div>
    <div class="line"></div>
    <div style="white-space:pre-wrap;line-height:1.55;font-size:13px">${esc(c.body_snapshot)}</div>
    ${
      patient
        ? `<div class="foot">Bemor: ${esc(patient)}${
            c.signer_relation !== 'self' && c.signer_name
              ? ` · Qonuniy vakil: ${esc(c.signer_name)}`
              : ''
          }</div>`
        : ''
    }
  `;
}

/** Rozilikni chop etish — desktop'da silent, brauzerda dialog bilan. */
export function printConsent(c: PatientConsent, clinicName: string): void {
  printA4Document(consentA4Html(c, clinicName), c.title_snapshot);
}
