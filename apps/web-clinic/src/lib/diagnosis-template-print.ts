import { printA4Document } from './print-receipt';

// =============================================================================
// Tashxis shabloni — A4 hujjat maketi (oldindan ko'rish + chop etish)
// =============================================================================
// Shifokor shablonni saqlashdan oldin uning qog'ozda QANDAY joylashishini
// ko'rishi kerak. Shu sabab bitta manbadan ikkita natija olamiz:
//   - ekrandagi A4 preview (kabinet sahifasidagi oyna)
//   - haqiqiy chop etish (printA4Document — desktop'da silent)
// Ikkalasi ham AYNI HTML va AYNI CSS ni ishlatadi, aks holda ekranda bir xil,
// qog'ozda boshqacha chiqadi.

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
  clinicName: string;
  doctorName?: string | null;
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** To'ldirilmagan joy — qog'ozda qo'lda yoziladigan chiziq. */
const BLANK = '<span style="color:#bbb">' + '.'.repeat(46) + '</span>';

function section(title: string, body?: string | null): string {
  const text = (body ?? '').trim();
  return `
    <div style="margin-top:12px">
      <div style="font-weight:600;font-size:12px;margin-bottom:3px">${esc(title)}</div>
      <div style="white-space:pre-wrap;line-height:1.5;min-height:18px">${
        text ? esc(text) : BLANK
      }</div>
    </div>`;
}

/**
 * Shablonning A4 tanasi. Bemorga oid maydonlar ATAYLAB bo'sh — bu shablon,
 * ya'ni qabulda to'ladigan blanka. Shifokor aynan shu joylashuvni ko'radi.
 */
export function templateA4Html(t: TemplateDoc, meta: TemplateDocMeta): string {
  const dx = [t.diagnosis_code, t.diagnosis_text].filter(Boolean).join(' — ');
  return `
    <div class="head">
      <div>
        <h1>Tibbiy xulosa</h1>
        <div class="muted small">${esc(meta.clinicName)}</div>
      </div>
      <div class="right small muted">
        <div>№ ${BLANK.replace(/\.{10,}/, '________')}</div>
        <div>Sana: ________________</div>
      </div>
    </div>
    <div class="line"></div>

    <div class="meta">
      <div><span class="k">Bemor:</span> ${BLANK}</div>
      <div><span class="k">Tug'ilgan sana:</span> ____________</div>
      <div><span class="k">Shifokor:</span> ${
        meta.doctorName ? esc(meta.doctorName) : BLANK
      }</div>
      <div><span class="k">Qabul turi:</span> ____________</div>
    </div>

    <div style="margin-top:6px">
      <div style="font-weight:600;font-size:12px;margin-bottom:3px">Tashxis (ICD-10)</div>
      <div style="line-height:1.5">${dx ? esc(dx) : BLANK}</div>
    </div>

    ${section('S — Shikoyat (subyektiv)', t.soap_subjective)}
    ${section("O — Obyektiv ko'rik", t.soap_objective)}
    ${section('A — Baho', t.soap_assessment)}
    ${section('P — Reja', t.soap_plan)}

    <div style="margin-top:34px;display:flex;justify-content:space-between">
      <div class="small muted">Shablon: ${esc(t.name)}</div>
      <div class="small">Imzo: ______________________</div>
    </div>
  `;
}

/**
 * Ekrandagi preview uchun CSS — print-receipt.ts dagi A4 uslubining
 * ayni nusxasi (@page dan tashqari, u faqat chop etishda ma'noga ega).
 * O'zgartirsangiz IKKALA joyda ham o'zgartiring, aks holda ekran va qog'oz
 * bir-biridan farq qila boshlaydi.
 */
export const A4_PREVIEW_CSS = `
  .a4-preview * { box-sizing: border-box; }
  .a4-preview { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111; background: #fff; }
  .a4-preview h1 { font-size: 20px; margin: 0 0 2px; }
  .a4-preview .muted { color: #666; }
  .a4-preview .small { font-size: 11px; }
  .a4-preview .right { text-align: right; }
  .a4-preview .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
  .a4-preview .line { border-top: 1px solid #000; margin: 10px 0; }
  .a4-preview .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin: 8px 0 14px; }
  .a4-preview .meta .k { color: #666; }
`;

/** Shablonni chop etish — desktop'da silent, brauzerda dialog bilan. */
export function printTemplate(t: TemplateDoc, meta: TemplateDocMeta): void {
  printA4Document(templateA4Html(t, meta), `Shablon — ${t.name}`);
}
