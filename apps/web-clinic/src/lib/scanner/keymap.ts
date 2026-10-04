// =============================================================================
// Klaviatura hodisasidan belgi — RASKLADKAGA BOG'LIQ EMAS
// =============================================================================
// Skaner (USB/Bluetooth HID) tugmalarni "bosadi". Kompyuterda rus/kirill
// raskladka yoqilgan bo'lsa `e.key` "ФИС123" beradi. `e.code` esa jismoniy
// tugma (KeyA, Digit1...) — shuning uchun US joylashuvi bo'yicha belgini
// o'zimiz tiklaymiz va kod har doim to'g'ri chiqadi.
// =============================================================================

export const GS_CHAR = '\u001d';

const CODE_MAP: Record<string, [string, string]> = {
  Digit0: ['0', ')'],
  Digit1: ['1', '!'],
  Digit2: ['2', '@'],
  Digit3: ['3', '#'],
  Digit4: ['4', '$'],
  Digit5: ['5', '%'],
  Digit6: ['6', '^'],
  Digit7: ['7', '&'],
  Digit8: ['8', '*'],
  Digit9: ['9', '('],
  Numpad0: ['0', '0'],
  Numpad1: ['1', '1'],
  Numpad2: ['2', '2'],
  Numpad3: ['3', '3'],
  Numpad4: ['4', '4'],
  Numpad5: ['5', '5'],
  Numpad6: ['6', '6'],
  Numpad7: ['7', '7'],
  Numpad8: ['8', '8'],
  Numpad9: ['9', '9'],
  NumpadDivide: ['/', '/'],
  NumpadMultiply: ['*', '*'],
  NumpadSubtract: ['-', '-'],
  NumpadAdd: ['+', '+'],
  NumpadDecimal: ['.', '.'],
  Minus: ['-', '_'],
  Equal: ['=', '+'],
  BracketLeft: ['[', '{'],
  BracketRight: [']', '}'],
  Backslash: ['\\', '|'],
  IntlBackslash: ['\\', '|'],
  Semicolon: [';', ':'],
  Quote: ["'", '"'],
  Comma: [',', '<'],
  Period: ['.', '>'],
  Slash: ['/', '?'],
  Backquote: ['`', '~'],
  Space: [' ', ' '],
};

for (let i = 0; i < 26; i++) {
  const lower = String.fromCharCode(97 + i);
  CODE_MAP[`Key${lower.toUpperCase()}`] = [lower, lower.toUpperCase()];
}

export interface KeyLike {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  getModifierState?: (k: string) => boolean;
}

/**
 * Hodisadan bitta belgi (yoki null — belgi emas: Shift, F1...).
 * GS (FNC1) — `Ctrl+]` yoki maxsus kalit sifatida keladi.
 */
export function charFromKey(e: KeyLike): string | null {
  if (e.key === 'GroupSeparator' || e.key === GS_CHAR) return GS_CHAR;
  if (
    e.ctrlKey &&
    !e.altKey &&
    (e.code === 'BracketRight' || e.key === ']' || e.key === '\u001d')
  ) {
    return GS_CHAR;
  }
  if (e.ctrlKey || e.metaKey) return null;
  const m = CODE_MAP[e.code];
  if (m) {
    const isLetter = /^Key[A-Z]$/.test(e.code);
    const caps = isLetter && !!e.getModifierState?.('CapsLock');
    const upper = e.shiftKey !== caps;
    return upper ? m[1] : m[0];
  }
  // Noma'lum fizik kod (ba'zi Bluetooth skanerlar) — e.key ga tayanamiz
  if (e.key && e.key.length === 1) return e.key;
  return null;
}
