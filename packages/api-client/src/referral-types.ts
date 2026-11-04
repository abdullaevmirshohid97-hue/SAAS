// Agentlar — statsionarga yo'llanma (shifokor taklifi / agent) bilan kelgan bemor.

export type ReferralPartnerType = 'agent' | 'doctor';

export type ReferralPartner = {
  id: string;
  type: ReferralPartnerType;
  name: string;
  specialty: string | null;
  workplace: string | null;
  phone: string | null;
  phone2: string | null;
  /** Xona to'lovidan ulush foizi (0–100). */
  commission_percent: number;
  notes: string | null;
  is_archived: boolean;
  created_at?: string;
};

export type ReferralPartnerInput = {
  type: ReferralPartnerType;
  name: string;
  specialty?: string | null;
  workplace?: string | null;
  phone?: string | null;
  phone2?: string | null;
  commission_percent?: number;
  notes?: string | null;
};

export type ReferralMoney = {
  days: number;
  accrued_uzs: number;
  paid_uzs: number;
  unpaid_uzs: number;
};

export type StayReferralPerson = {
  id: string;
  name: string;
  specialty: string | null;
  workplace: string | null;
  phone: string | null;
  phone2: string | null;
  is_archived: boolean;
  /** Shu bemor uchun foiz (qabuldagi snapshot yoki admin o'zgartirgani). */
  percent: number;
};

export type StayReferral = {
  stay_id: string;
  admission_channel: 'self' | 'referral';
  doctor: StayReferralPerson | null;
  agent: StayReferralPerson | null;
  /** Faqat admin uchun (boshqa rollarda null). */
  totals: { doctor: ReferralMoney; agent: ReferralMoney } | null;
  can_edit: boolean;
};

export type StayReferralInput = {
  admission_channel: 'self' | 'referral';
  referring_doctor_id?: string | null;
  agent_id?: string | null;
  referring_doctor_percent?: number;
  agent_percent?: number;
};

export type ReferralSummaryRow = ReferralPartner & {
  stays: number;
  active_stays: number;
  accrued_uzs: number;
  paid_uzs: number;
  unpaid_uzs: number;
  last_paid_at: string | null;
};

export type ReferralSummary = {
  partners: ReferralSummaryRow[];
  totals: { accrued_uzs: number; paid_uzs: number; unpaid_uzs: number };
};

export type ReferralStayRow = {
  stay_id: string;
  role: ReferralPartnerType;
  percent: number;
  days: number;
  accrued_uzs: number;
  paid_uzs: number;
  unpaid_uzs: number;
  patient_name: string;
  patient_phone: string | null;
  room_number: string | null;
  admitted_at: string | null;
  discharged_at: string | null;
  status: string;
  /** Bemorning shu yotishdagi to'lanmagan summasi (to'lovni bloklamaydi). */
  patient_debt_uzs: number;
};

export type ReferralPayout = {
  id: string;
  amount_uzs: number;
  method: string;
  source: string;
  status: 'paid' | 'canceled' | string;
  notes: string | null;
  paid_at: string;
  canceled_at: string | null;
  paid_by_name: string | null;
};

export type ReferralPartnerDetail = {
  partner: ReferralPartner;
  stays: ReferralStayRow[];
  payouts: ReferralPayout[];
  totals: { accrued_uzs: number; paid_uzs: number; unpaid_uzs: number };
};

export type ReferralPayoutInput = {
  stay_ids?: string[];
  method: 'cash' | 'card' | 'transfer' | 'click' | 'payme' | 'humo' | 'uzcard';
  source?: 'cash_drawer' | 'safe';
  notes?: string;
};

export type ReferralPayoutResult = {
  payout_id: string;
  amount_uzs: number;
  stays: number;
  partner: { id: string; name: string; type: ReferralPartnerType };
  method: string;
  source: string;
  paid_at: string;
};
