import { useCallback, useEffect, useRef, useState } from 'react';

// =============================================================================
// QORALAMA HOLATI — yorliq almashsa yoki sahifa yopilsa ham yo'qolmaydi
// =============================================================================
// MUAMMO (2026-08-11, dorixona prixoti): sahifadagi yorliqlar shart bo'yicha
// render qilinadi (`{tab === 'receipt' && <ReceiptTab />}`), ya'ni boshqa
// yorliqqa o'tilganda komponent UNMOUNT bo'ladi va React holati butunlay
// o'chadi. Operator 20 ta dori kiritib, "Firmalar" yorlig'iga bir soniyaga
// o'tsa — hammasi yo'q. Tasodifan brauzer yangilansa ham xuddi shunday.
//
// Yechim: holat localStorage'ga ko'zgu qilinadi. Bu server qoralamasi emas —
// qurilmaga bog'liq, lekin aynan shu holat uchun yetarli va oddiy.
//
// TUZOQ (ataylab hal qilingan): `useState(() => JSON.parse(...))` yozilsa,
// yozuv effekti birinchi renderda ham ishga tushib, boshqa tabdagi yangi
// qiymatni eskisi bilan almashtirib yuborishi mumkin. Shuning uchun birinchi
// yozuv o'tkazib yuboriladi (`skipFirstWrite`).
// =============================================================================

/** Qoralamalar uchun kalit prefiksi — boshqa localStorage yozuvlaridan ajratish. */
const PREFIX = 'clary.draft.';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // Buzilgan qoralama butun sahifani yiqitmasin.
    return fallback;
  }
}

/**
 * `useState` kabi, lekin qiymat localStorage'da saqlanadi.
 *
 * @param key       barqaror kalit (masalan `pharmacy.receipt.lines`)
 * @param initial   qoralama bo'lmasa ishlatiladigan boshlang'ich qiymat
 * @returns `[value, setValue, clear]` — `clear()` qoralamani o'chirib,
 *          boshlang'ich qiymatga qaytaradi (saqlangandan keyin chaqiriladi).
 */
export function useDraftState<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const [value, setValue] = useState<T>(() => read(key, initial));
  const skipFirstWrite = useRef(true);

  useEffect(() => {
    if (skipFirstWrite.current) {
      skipFirstWrite.current = false;
      return;
    }
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // Kvota to'lgan bo'lsa jimgina o'tkazamiz — ish to'xtamasin.
    }
  }, [key, value]);

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* ahamiyatsiz */
    }
    skipFirstWrite.current = true;
    setValue(initial);
    // `initial` har renderda yangi obyekt bo'lishi mumkin — u qasddan
    // bog'liqlikka kiritilmagan (aks holda `clear` har renderda o'zgaradi).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, setValue, clear];
}

/** Bir nechta qoralama kalitini birdaniga o'chiradi (forma saqlangach). */
export function clearDrafts(keys: string[]): void {
  for (const k of keys) {
    try {
      localStorage.removeItem(PREFIX + k);
    } catch {
      /* ahamiyatsiz */
    }
  }
}

/** Qoralamada saqlangan narsa bormi — "tiklandi" xabarini ko'rsatish uchun. */
export function hasDraft(keys: string[]): boolean {
  return keys.some((k) => {
    try {
      const raw = localStorage.getItem(PREFIX + k);
      if (raw === null) return false;
      const v = JSON.parse(raw) as unknown;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'string') return v.length > 0;
      return v !== null && v !== undefined;
    } catch {
      return false;
    }
  });
}
