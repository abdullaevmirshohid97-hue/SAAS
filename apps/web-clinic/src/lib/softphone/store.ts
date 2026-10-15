import { create } from 'zustand';
import type { PbxLookupResult, PbxSoftphoneAccount } from '@clary/api-client';

// =============================================================================
// Clary softfoni — holat (zustand). SIP/WebRTC mantiqi: ./engine.ts
// =============================================================================

export type RegState = 'off' | 'connecting' | 'registered' | 'failed';

export type CallPhase =
  /** Kiruvchi — jiringlayapti (javob kutilmoqda) */
  | 'ringing'
  /** Chiquvchi — terilmoqda / u tomonda jiringlayapti */
  | 'calling'
  | 'active'
  | 'ended';

export interface SoftphoneCall {
  id: string;
  direction: 'in' | 'out';
  /** Raqam (ko'rsatish uchun) */
  number: string;
  name: string | null;
  phase: CallPhase;
  startedAt: number;
  answeredAt: number | null;
  muted: boolean;
  held: boolean;
  /** Tugash sababi (ended) */
  cause: string | null;
  /** Kiruvchi raqam bo'yicha bemor(lar) */
  lookup: PbxLookupResult | null;
}

const ENABLED_KEY = 'clary.softphone.enabled';

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== '0';
  } catch {
    return true;
  }
}

interface SoftphoneState {
  account: PbxSoftphoneAccount | null;
  /** Foydalanuvchi o'chirib qo'ygan bo'lsa — shu kompyuterda jiringlamaydi */
  enabled: boolean;
  reg: RegState;
  regError: string | null;
  call: SoftphoneCall | null;
  panelOpen: boolean;
  /** Panel teruvchisidagi raqam (bemor kartasidan "Qo'ng'iroq" bosilganda to'ladi) */
  draft: string;

  setAccount: (a: PbxSoftphoneAccount | null) => void;
  setEnabled: (v: boolean) => void;
  setReg: (reg: RegState, error?: string | null) => void;
  setCall: (c: SoftphoneCall | null) => void;
  patchCall: (p: Partial<SoftphoneCall>) => void;
  setPanelOpen: (v: boolean) => void;
  setDraft: (v: string) => void;
}

export const useSoftphone = create<SoftphoneState>((set) => ({
  account: null,
  enabled: readEnabled(),
  reg: 'off',
  regError: null,
  call: null,
  panelOpen: false,
  draft: '',

  setAccount: (account) => set({ account }),
  setEnabled: (enabled) => {
    try {
      localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0');
    } catch {
      /* private rejim */
    }
    set({ enabled });
  },
  setReg: (reg, error = null) => set({ reg, regError: error }),
  setCall: (call) => set({ call }),
  patchCall: (p) => set((s) => (s.call ? { call: { ...s.call, ...p } } : {})),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setDraft: (draft) => set({ draft }),
}));

/** Softfon ishlatsa bo'ladimi (klinikada ATS yoqilgan va xodimga ichki raqam biriktirilgan). */
export function softphoneAvailable(a: PbxSoftphoneAccount | null): boolean {
  return !!a && a.enabled;
}
