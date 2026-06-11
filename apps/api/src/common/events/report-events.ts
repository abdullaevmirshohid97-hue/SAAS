import { EventEmitter } from 'node:events';

/**
 * Hisobot hodisalari — kassa/smena modullari emit qiladi, TelegramReports
 * moduli tinglaydi. Oddiy Node EventEmitter — modullar orasida to'g'ridan
 * import bog'liqligi (circular dependency) bo'lmasligi uchun.
 */
export type ReportEvent =
  | { type: 'shift_opened'; clinicId: string; shiftId: string }
  | { type: 'shift_closed'; clinicId: string; shiftId: string }
  | { type: 'encash'; clinicId: string; amountUzs: number; destination?: string; notes?: string }
  | { type: 'expense'; clinicId: string; amountUzs: number; notes?: string }
  | { type: 'refund'; clinicId: string; amountUzs: number; notes?: string }
  | { type: 'adjustment'; clinicId: string; amountUzs: number; notes?: string }
  | { type: 'safe_deposit'; clinicId: string; amountUzs: number; notes?: string };

export const reportEvents = new EventEmitter();
// Bir nechta listener xavfsiz bo'lsin (test + servis)
reportEvents.setMaxListeners(20);

export function emitReportEvent(event: ReportEvent): void {
  // Fire-and-forget — emit hech qachon chaqiruvchini bloklamaydi/yiqitmaydi.
  try {
    reportEvents.emit('report', event);
  } catch {
    // listener xatosi asosiy oqimni buzmasin
  }
}
