// Payslip sozlamalari — localStorage'da saqlanadi.
// Foydalanuvchi sozlamalar/printer sahifasidan boshqaradi.

export type PayslipWidth = '58mm' | '80mm' | 'a4';

export type PayslipSection =
  | 'clinic_header' // klinika nomi, manzil, telefon
  | 'doc_badge' // hujjat raqami (PS-XXXXXX)
  | 'employee_position' // lavozim
  | 'generated_at' // tayyorlangan sana
  | 'commissions' // komissiya qatori
  | 'monthly_base' // oylik fix
  | 'bonuses' // bonus
  | 'advances' // avans
  | 'penalties' // jarima
  | 'gross_total' // jami gross
  | 'deductions_total' // jami ushlanma
  | 'net_block' // SOF MAOSH bo'limi
  | 'signatures' // imzo qatorlari
  | 'footer'; // brand footer

export type PayslipFontFamily = 'monospace' | 'sans-serif' | 'serif';
export type PayslipFontWeight = 'light' | 'normal' | 'medium' | 'bold';
export type PayslipFontStyle = 'normal' | 'italic';

export type PayslipSettings = {
  paper_width: PayslipWidth;
  title: string; // sarlavha matni (default "Maosh varaqasi" / "PAYSLIP")
  sections: Record<PayslipSection, boolean>;
  // Termal uchun font o'lchami (9-18)
  thermal_font_size: number;
  // Font ko'rinishi
  font_family: PayslipFontFamily;
  font_weight: PayslipFontWeight;
  font_style: PayslipFontStyle;
  // Pastki maxsus matn (footer)
  footer_note: string;
};

const STORAGE_KEY = 'clary_payslip_settings_v1';

const DEFAULT_SETTINGS: PayslipSettings = {
  paper_width: 'a4',
  title: 'Maosh varaqasi',
  sections: {
    clinic_header: true,
    doc_badge: true,
    employee_position: true,
    generated_at: true,
    commissions: true,
    monthly_base: true,
    bonuses: true,
    advances: true,
    penalties: true,
    gross_total: true,
    deductions_total: true,
    net_block: true,
    signatures: true,
    footer: true,
  },
  thermal_font_size: 12,
  font_family: 'monospace',
  font_weight: 'normal',
  font_style: 'normal',
  footer_note: 'Clary Clinic CRM • Avtomatik hosil qilingan hujjat',
};

export const FONT_FAMILY_LABELS: Record<PayslipFontFamily, string> = {
  monospace: 'Monospace (chek standart)',
  'sans-serif': 'Sans-serif (zamonaviy)',
  serif: 'Serif (kitobiy)',
};

export const FONT_WEIGHT_LABELS: Record<PayslipFontWeight, { label: string; css: number }> = {
  light: { label: 'Yengil (300)', css: 300 },
  normal: { label: 'Oddiy (400)', css: 400 },
  medium: { label: "O'rta (500)", css: 500 },
  bold: { label: 'Qalin (700)', css: 700 },
};

export const FONT_FAMILY_CSS: Record<PayslipFontFamily, string> = {
  monospace: "'JetBrains Mono', 'Courier New', ui-monospace, monospace",
  'sans-serif': "'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  serif: "'Times New Roman', Georgia, serif",
};

export function getPayslipSettings(): PayslipSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PayslipSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      sections: { ...DEFAULT_SETTINGS.sections, ...(parsed.sections ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function savePayslipSettings(s: PayslipSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

export function resetPayslipSettings(): PayslipSettings {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  return DEFAULT_SETTINGS;
}

export const PAYSLIP_SECTION_LABELS: Record<PayslipSection, string> = {
  clinic_header: 'Klinika sarlavhasi (nomi, manzili, telefon)',
  doc_badge: 'Hujjat raqami (PS-XXXXXX)',
  employee_position: 'Xodim lavozimi',
  generated_at: 'Tayyorlangan sana',
  commissions: 'Komissiya qatori',
  monthly_base: 'Oylik fix qatori',
  bonuses: 'Bonus qatori',
  advances: 'Avans qatori',
  penalties: 'Jarima qatori',
  gross_total: 'Jami gross',
  deductions_total: 'Jami ushlanma',
  net_block: 'Sof maosh (NET) blok',
  signatures: 'Imzo qatorlari',
  footer: 'Pastki matn (footer)',
};
