import { describe, expect, it } from 'vitest';

import { DEFAULT_TEMPLATES, PLACEHOLDERS } from './consent-defaults';
import { fmtConsentDate, joinParts, renderConsentBody } from './consent-render';

// ── renderConsentBody ────────────────────────────────────────────────────────
describe('renderConsentBody', () => {
  it('placeholder o‘rniga qiymat qo‘yadi', () => {
    expect(renderConsentBody('Men, {{bemor_fio}}, roziman', { bemor_fio: 'Ali Valiyev' })).toBe(
      'Men, Ali Valiyev, roziman',
    );
  });

  it('bir placeholder bir necha marta uchrasa hammasini almashtiradi', () => {
    expect(renderConsentBody('{{a}} va {{a}}', { a: 'X' })).toBe('X va X');
  });

  it('ichki bo‘shliqqa chidamli', () => {
    expect(renderConsentBody('{{ bemor_fio }}', { bemor_fio: 'Ali' })).toBe('Ali');
  });

  it('noma’lum kalitni BO‘SH qoldiradi — qog‘ozda xom {{...}} chiqmasin', () => {
    expect(renderConsentBody('Shifokor: {{yoq_kalit}}.', {})).toBe('Shifokor: .');
  });

  it('qiymat bo‘lmasa (bo‘sh satr) ham xom placeholder qoldirmaydi', () => {
    const out = renderConsentBody('Muolaja: {{muolaja}}', { muolaja: '' });
    expect(out).toBe('Muolaja: ');
    expect(out).not.toContain('{{');
  });

  it('placeholder bo‘lmagan matnni o‘zgartirmaydi', () => {
    const src = 'Oddiy matn, { bitta } qavs va 100{200}.';
    expect(renderConsentBody(src, { a: 'X' })).toBe(src);
  });
});

// ── Default shablonlar butunligi ─────────────────────────────────────────────
describe('DEFAULT_TEMPLATES', () => {
  const known = new Set<string>(PLACEHOLDERS.map((p) => p.key));

  it('har bir kod uchun uz va ru versiyasi bor', () => {
    for (const code of ['general', 'inpatient', 'dental', 'personal_data']) {
      for (const lang of ['uz', 'ru']) {
        expect(
          DEFAULT_TEMPLATES.some((t) => t.code === code && t.lang === lang),
          `${code}/${lang} shabloni yo‘q`,
        ).toBe(true);
      }
    }
  });

  it('faqat ro‘yxatdagi placeholder’lardan foydalanadi', () => {
    for (const t of DEFAULT_TEMPLATES) {
      const used = [...t.body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1] ?? '');
      for (const key of used) {
        expect(known.has(key), `${t.code}/${t.lang}: noma’lum {{${key}}}`).toBe(true);
      }
    }
  });

  it('to‘liq render qilinganda xom placeholder qolmaydi', () => {
    const vars = Object.fromEntries(PLACEHOLDERS.map((p) => [p.key, 'X']));
    for (const t of DEFAULT_TEMPLATES) {
      expect(renderConsentBody(t.body, vars)).not.toContain('{{');
    }
  });

  it('har bir shablonda imzo joyi bor', () => {
    for (const t of DEFAULT_TEMPLATES) {
      expect(t.body, `${t.code}/${t.lang}`).toContain('_____');
    }
  });
});

// ── fmtConsentDate ───────────────────────────────────────────────────────────
describe('fmtConsentDate', () => {
  it('kun.oy.yil formatida, nol bilan', () => {
    expect(fmtConsentDate('2026-08-07T10:00:00Z')).toMatch(/^\d{2}\.\d{2}\.2026$/);
  });

  it('bo‘sh yoki noto‘g‘ri sana — bo‘sh satr', () => {
    expect(fmtConsentDate(null)).toBe('');
    expect(fmtConsentDate('salom')).toBe('');
  });
});

// ── joinParts ────────────────────────────────────────────────────────────────
describe('joinParts', () => {
  it('bo‘sh bo‘laklarni tashlaydi', () => {
    expect(joinParts(['Toshkent', null, '', 'Chilonzor'])).toBe('Toshkent, Chilonzor');
  });

  it('hammasi bo‘sh bo‘lsa bo‘sh satr', () => {
    expect(joinParts([null, undefined, '  '])).toBe('');
  });
});
