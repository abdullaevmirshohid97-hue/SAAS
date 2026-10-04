// =============================================================================
// Alohida "Dorixona" kirishi — shu kompyuterdagi qurilma kaliti va PIN sessiyasi
// =============================================================================
// Qurilma kaliti bir marta yaratiladi va shu brauzer/kompyuterda saqlanadi
// (ro'yxatdan o'tgan kompyuter shu kalit bilan taniladi). PIN sessiyasi
// (Admin / Kassa 1 / Kassa 2) — ekran qulflanganda yoki chiqilganda o'chadi.
// Sarlavhalar faqat dorixona akkauntida yuboriladi (klinikaga ta'sirsiz).
// =============================================================================

const DEVICE_KEY = 'clary.pharmacy.device';
const SESSION_KEY = 'clary.pharmacy.session';
const ENTRY_KEY = 'clary.entry';

export type EntryKind = 'clinic' | 'pharmacy';

export interface OperatorSession {
  token: string;
  expires_at: string;
  operator: {
    id: string;
    full_name: string;
    role: 'admin' | 'cashier';
    register_no: number | null;
    can_return: boolean;
    can_receive: boolean;
    can_discount: boolean;
  };
}

let workspaceActive = false;
const listeners = new Set<() => void>();

/** AuthProvider dorixona akkauntini aniqlaganda yoqadi. */
export function setPharmacyWorkspaceActive(v: boolean) {
  workspaceActive = v;
}

export function isPharmacyWorkspaceActive(): boolean {
  return workspaceActive;
}

function randomKey(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return `dev_${crypto.randomUUID()}_${Math.random().toString(36).slice(2, 10)}`;
    }
  } catch {
    /* fallback quyida */
  }
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

export function getDeviceKey(): string {
  try {
    let k = localStorage.getItem(DEVICE_KEY);
    if (!k) {
      k = randomKey();
      localStorage.setItem(DEVICE_KEY, k);
    }
    return k;
  } catch {
    return 'dev_unavailable_storage';
  }
}

export function getOperatorSession(): OperatorSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as OperatorSession;
    if (!s?.token || new Date(s.expires_at).getTime() < Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function setOperatorSession(s: OperatorSession) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* saqlanmasa — keyingi so'rovda PIN so'raladi */
  }
  listeners.forEach((l) => l());
}

export function clearOperatorSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function onOperatorSessionChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** API so'rovlariga qo'shiladigan sarlavhalar. */
export function pharmacyHeaders(): Record<string, string> {
  if (!workspaceActive) return {};
  const h: Record<string, string> = { 'X-Pharmacy-Device': getDeviceKey() };
  const s = getOperatorSession();
  if (s) h['X-Pharmacy-Operator'] = s.token;
  return h;
}

// ---- Kirish tanlovi (Klinika | Dorixona) — shu kompyuterda eslab qolinadi ----
export function getEntryChoice(): EntryKind | null {
  try {
    const v = localStorage.getItem(ENTRY_KEY);
    return v === 'clinic' || v === 'pharmacy' ? v : null;
  } catch {
    return null;
  }
}

export function setEntryChoice(v: EntryKind | null) {
  try {
    if (v) localStorage.setItem(ENTRY_KEY, v);
    else localStorage.removeItem(ENTRY_KEY);
  } catch {
    /* ignore */
  }
}

// ---- Global xato kodlari → dorixona kirish ekrani ----------------------------
export const PHARMACY_WS_EVENT = 'clary:pharmacy-ws';
export const PHARMACY_WS_CODES: readonly string[] = [
  'PHARMACY_SUBSCRIPTION_INACTIVE',
  'DEVICE_NOT_REGISTERED',
  'DEVICE_REVOKED',
  'OPERATOR_PIN_REQUIRED',
];
