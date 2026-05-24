// Smena hisoboti chop etish sozlamalari — localStorage'da.

export type ShiftReportWidth = '58mm' | '80mm' | 'a4';

export type ShiftReportSection =
  | 'clinic_header'
  | 'operator_info'
  | 'period_info'
  | 'kpi_block'
  | 'transactions_table'
  | 'expenses_table'
  | 'staff_list'
  | 'salary_payouts'
  | 'cash_breakdown'
  | 'signatures'
  | 'footer';

export type ShiftReportFontFamily = 'monospace' | 'sans-serif' | 'serif';
export type ShiftReportFontWeight = 'light' | 'normal' | 'medium' | 'bold';
export type ShiftReportFontStyle = 'normal' | 'italic';

export type ShiftReportSettings = {
  paper_width: ShiftReportWidth;
  title: string;
  sections: Record<ShiftReportSection, boolean>;
  thermal_font_size: number;
  font_family: ShiftReportFontFamily;
  font_weight: ShiftReportFontWeight;
  font_style: ShiftReportFontStyle;
  footer_note: string;
  // Tranzaksiyalar jadvalida nechta qatordan ko'p ko'rsatmaslik (termal uchun)
  max_transactions_thermal: number;
};

const STORAGE_KEY = 'clary_shift_report_settings_v1';

const DEFAULT_SETTINGS: ShiftReportSettings = {
  paper_width: 'a4',
  title: 'Smena hisoboti',
  sections: {
    clinic_header: true,
    operator_info: true,
    period_info: true,
    kpi_block: true,
    transactions_table: true,
    expenses_table: true,
    staff_list: true,
    salary_payouts: true,
    cash_breakdown: true,
    signatures: true,
    footer: true,
  },
  thermal_font_size: 11,
  font_family: 'monospace',
  font_weight: 'normal',
  font_style: 'normal',
  footer_note: 'Clary Clinic CRM',
  max_transactions_thermal: 30,
};

export function getShiftReportSettings(): ShiftReportSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ShiftReportSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      sections: { ...DEFAULT_SETTINGS.sections, ...(parsed.sections ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveShiftReportSettings(s: ShiftReportSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

export function resetShiftReportSettings(): ShiftReportSettings {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  return DEFAULT_SETTINGS;
}

export const SHIFT_REPORT_SECTION_LABELS: Record<ShiftReportSection, string> = {
  clinic_header: 'Klinika sarlavhasi (nomi, manzili, telefon)',
  operator_info: 'Navbatchi (operator) ma\'lumoti',
  period_info: 'Smena boshi va oxiri sanasi',
  kpi_block: 'Asosiy ko\'rsatkichlar (tushum, rasxot, foyda)',
  transactions_table: 'Tranzaksiyalar jadvali',
  expenses_table: 'Rasxotlar jadvali',
  staff_list: 'Ishlagan xodimlar ro\'yxati',
  salary_payouts: 'Berilgan maoshlar',
  cash_breakdown: 'Naqd/karta/online tafsilot',
  signatures: 'Imzo qatorlari (navbatchi + boshlig\'i)',
  footer: 'Pastki matn (footer)',
};

export const SHIFT_FONT_FAMILY_LABELS: Record<ShiftReportFontFamily, string> = {
  monospace: 'Monospace (chek standart)',
  'sans-serif': 'Sans-serif (zamonaviy)',
  serif: 'Serif (kitobiy)',
};

export const SHIFT_FONT_WEIGHT_LABELS: Record<ShiftReportFontWeight, { label: string; css: number }> = {
  light: { label: 'Yengil (300)', css: 300 },
  normal: { label: 'Oddiy (400)', css: 400 },
  medium: { label: "O'rta (500)", css: 500 },
  bold: { label: 'Qalin (700)', css: 700 },
};

export const SHIFT_FONT_FAMILY_CSS: Record<ShiftReportFontFamily, string> = {
  monospace: "'JetBrains Mono', 'Courier New', ui-monospace, monospace",
  'sans-serif': "'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  serif: "'Times New Roman', Georgia, serif",
};
