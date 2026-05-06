import { useEffect, useRef, useState } from 'react';

/**
 * useState dan farq qiladigan tomoni: qiymat localStorage'da saqlanadi
 * va sahifa qayta yuklanganda tiklanadi. JSON-serializable bo'lishi shart.
 *
 * Reception cart kabi flow'larda foydali — bemor / xizmatlar / to'lov turi
 * boshqa oynaga o'tilsa ham yo'qolmasligi kerak (qabul yakunlangunga qadar).
 */
export function usePersistedState<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const isFirstLoad = useRef(true);

  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      return;
    }
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // quota exceeded yoki disabled — jim yutamiz
    }
  }, [key, value]);

  const clear = () => {
    try {
      window.localStorage.removeItem(key);
    } catch {}
  };

  return [value, setValue, clear];
}
