import { useEffect, useRef } from 'react';

import { scannerHub, type ScanEvent } from './scanner';

/**
 * Sahifa/dialog skaner kodlarini tinglaydi. Bir vaqtda bitta obunachi oladi:
 * ustuvorligi yuqori (dialoglar uchun 10), teng bo'lsa — oxirgi ochilgani.
 */
export function useScanner(
  handler: (e: ScanEvent) => void,
  opts: { enabled?: boolean; priority?: number } = {},
) {
  const ref = useRef(handler);
  ref.current = handler;
  const enabled = opts.enabled ?? true;
  const priority = opts.priority ?? 0;

  useEffect(() => {
    scannerHub.start();
    if (!enabled) return;
    return scannerHub.subscribe(ref, priority);
  }, [enabled, priority]);
}

export { scannerHub, type ScanEvent };
