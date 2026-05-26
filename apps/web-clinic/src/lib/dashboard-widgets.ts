// Dashboard widget'lari rol bo'yicha ko'rinishi.
// Har widget kalitiga ruxsat etilgan rollar ro'yxati.
// Rol yo'q (`staff`) yoki noma'lum bo'lsa — eng kam huquq (faqat tezkor amallar).

type Role =
  | 'super_admin'
  | 'clinic_owner'
  | 'clinic_admin'
  | 'doctor'
  | 'nurse'
  | 'receptionist'
  | 'cashier'
  | 'staff';

export type DashboardWidget =
  | 'kpi-queue'
  | 'kpi-appts'
  | 'kpi-revenue'
  | 'kpi-profit'
  | 'ai-summary'
  | 'top-services'
  | 'quick-actions'
  | 'top-doctors'
  | 'top-debtors'
  | 'inpatient-panel'
  | 'time-series'
  | 'new-patients'
  | 'birthdays'
  | 'shift-diff'
  | 'cash-anomaly'
  | 'refund-fraud'
  | 'patient-segmentation';

const WIDGET_VISIBILITY: Record<DashboardWidget, Role[]> = {
  'kpi-queue':       ['super_admin', 'clinic_owner', 'clinic_admin', 'doctor', 'nurse', 'receptionist'],
  'kpi-appts':       ['super_admin', 'clinic_owner', 'clinic_admin', 'doctor', 'nurse', 'receptionist'],
  'kpi-revenue':     ['super_admin', 'clinic_owner', 'clinic_admin', 'cashier'],
  'kpi-profit':      ['super_admin', 'clinic_owner', 'clinic_admin'],
  'ai-summary':      ['super_admin', 'clinic_owner', 'clinic_admin', 'doctor', 'nurse', 'receptionist', 'cashier'],
  'top-services':    ['super_admin', 'clinic_owner', 'clinic_admin'],
  'quick-actions':   ['super_admin', 'clinic_owner', 'clinic_admin', 'doctor', 'nurse', 'receptionist', 'cashier'],
  'top-doctors':     ['super_admin', 'clinic_owner', 'clinic_admin'],
  'top-debtors':     ['super_admin', 'clinic_owner', 'clinic_admin', 'cashier'],
  'inpatient-panel': ['super_admin', 'clinic_owner', 'clinic_admin', 'doctor', 'nurse'],
  'time-series':     ['super_admin', 'clinic_owner', 'clinic_admin'],
  'new-patients':    ['super_admin', 'clinic_owner', 'clinic_admin', 'receptionist'],
  'birthdays':       ['super_admin', 'clinic_owner', 'clinic_admin', 'receptionist'],
  'shift-diff':      ['super_admin', 'clinic_owner', 'clinic_admin', 'cashier'],
  'cash-anomaly':    ['super_admin', 'clinic_owner', 'clinic_admin'],
  'refund-fraud':    ['super_admin', 'clinic_owner', 'clinic_admin'],
  'patient-segmentation': ['super_admin', 'clinic_owner', 'clinic_admin', 'receptionist'],
};

export function canShowWidget(widget: DashboardWidget, role: string): boolean {
  const allowed = WIDGET_VISIBILITY[widget];
  return allowed ? (allowed as string[]).includes(role) : false;
}
