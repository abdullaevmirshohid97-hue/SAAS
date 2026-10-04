import { describe, expect, it } from 'vitest';

import { charFromKey } from './keymap';
import { ScanAssembler } from './scanner';

const key = (
  code: string,
  shift = false,
  extra: Partial<{ key: string; ctrl: boolean; caps: boolean }> = {},
) => ({
  key: extra.key ?? '',
  code,
  shiftKey: shift,
  ctrlKey: !!extra.ctrl,
  altKey: false,
  metaKey: false,
  getModifierState: (k: string) => (k === 'CapsLock' ? !!extra.caps : false),
});

describe('charFromKey — raskladkadan mustaqil', () => {
  it('kirill raskladkada ham lotin harf qaytaradi', () => {
    // Rus raskladkada KeyA tugmasi "ф" beradi — biz "a" olishimiz kerak
    expect(charFromKey(key('KeyA', false, { key: 'ф' }))).toBe('a');
    expect(charFromKey(key('KeyA', true, { key: 'Ф' }))).toBe('A');
    expect(charFromKey(key('Digit7'))).toBe('7');
    expect(charFromKey(key('Numpad3'))).toBe('3');
  });

  it('CapsLock yoqilgan bo‘lsa harf registri OS kabi', () => {
    expect(charFromKey(key('KeyB', false, { caps: true }))).toBe('B');
    expect(charFromKey(key('KeyB', true, { caps: true }))).toBe('b');
  });

  it('GS (FNC1) — Ctrl+]', () => {
    expect(charFromKey(key('BracketRight', false, { ctrl: true }))).toBe('\u001d');
  });

  it('modifikator — belgi emas', () => {
    expect(charFromKey(key('ShiftLeft', true, { key: 'Shift' }))).toBeNull();
  });
});

describe('ScanAssembler', () => {
  it('tez belgilar + Enter → skaner kodi', () => {
    const a = new ScanAssembler({ maxGapMs: 35, minLength: 4 });
    let t = 1000;
    for (const ch of '4006381333931') {
      a.push(ch, t);
      t += 8;
    }
    const r = a.complete(t);
    expect(r?.raw).toBe('4006381333931');
    expect(r?.avgGapMs).toBeLessThan(10);
  });

  it('odam yozishi (sekin) skaner deb olinmaydi', () => {
    const a = new ScanAssembler({ maxGapMs: 35, minLength: 4 });
    let t = 1000;
    for (const ch of '12345') {
      a.push(ch, t);
      t += 150;
    }
    expect(a.complete(t)).toBeNull();
  });

  it('pauzadan keyin yangi ketma-ketlik boshlanadi', () => {
    const a = new ScanAssembler({ maxGapMs: 35, minLength: 4 });
    a.push('x', 0);
    expect(a.push('1', 500).restarted).toBe(true);
    let t = 500;
    for (const ch of '234') {
      t += 5;
      a.push(ch, t);
    }
    expect(a.complete(t + 5)?.raw).toBe('1234');
  });

  it('juda qisqa kod — skaner emas', () => {
    const a = new ScanAssembler({ maxGapMs: 35, minLength: 4 });
    a.push('1', 0);
    a.push('2', 5);
    expect(a.complete(10)).toBeNull();
  });
});
