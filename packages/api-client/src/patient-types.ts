// Bemorlar daftari ("xotira daftari") — API javob turlari.

export interface PatientStats {
  /** Necha marta kelgan (alohida kunlar: qabul + statsionarga yotqizilish). */
  visits: number;
  first_visit_at: string | null;
  last_visit_at: string | null;
  paid_uzs: number;
  debt_uzs: number;
  stays: number;
  in_stay: boolean;
}

export interface PatientRegistryItem {
  id: string;
  full_name: string;
  last_name: string | null;
  first_name: string | null;
  phone: string | null;
  dob: string | null;
  gender: string | null;
  created_at: string;
  stats: PatientStats | null;
}

export type PatientRegistryFilter = 'all' | 'debtors' | 'inpatient';

export interface PatientMatchResult {
  patient: {
    id: string;
    full_name: string;
    phone: string | null;
    dob: string | null;
    gender: string | null;
    address: string | null;
  } | null;
  /** Shu uchta ma'lumot bilan ochilgan qo'shimcha (dublikat) kartalar soni. */
  duplicates: number;
  stats: PatientStats | null;
}

export interface PatientHistory {
  patient: Record<string, unknown> & {
    id: string;
    full_name: string;
    phone: string | null;
    dob: string | null;
    gender: string | null;
    address: string | null;
  };
  summary: PatientStats & { balance_uzs: number };
  visits: Array<{
    date: string;
    services: string[];
    doctors: string[];
    amount_uzs: number;
    methods: string[];
  }>;
  services: Array<{
    name: string;
    count: number;
    amount_uzs: number;
    last_at: string;
    doctors: string[];
  }>;
  doctors: Array<{ name: string; visits: number; last_at: string }>;
  payment_methods: Array<{ method: string; count: number; amount_uzs: number }>;
  diagnoses: Array<{
    date: string;
    code: string | null;
    text: string | null;
    doctor: string | null;
    source: 'outpatient' | 'inpatient' | 'admission';
  }>;
  medications: Array<{
    date: string;
    name: string;
    dosage: string | null;
    quantity: number;
    source: 'prescription' | 'pharmacy';
    doctor: string | null;
  }>;
  stays: Array<{
    id: string;
    admitted_at: string;
    discharged_at: string | null;
    days: number;
    status: string;
    admission_reason: string | null;
    diagnoses: Array<{
      code: string | null;
      text: string | null;
      date: string;
      doctor: string | null;
    }>;
    discharge_summary: string | null;
    discharge_reason: string | null;
    total_cost_uzs: number;
    discharged_with_debt: boolean;
    bed_no: string | null;
    room: {
      number: string;
      floor: number | null;
      building: string | null;
      section: string | null;
    } | null;
    doctor: string | null;
  }>;
  /** O'qilmay qolgan bo'limlar (qolgani baribir ko'rsatiladi). */
  warnings: string[];
}
