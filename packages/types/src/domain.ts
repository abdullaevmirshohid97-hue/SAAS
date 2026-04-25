export type Role =
  | 'super_admin'
  | 'clinic_owner'
  | 'clinic_admin'
  | 'doctor'
  | 'receptionist'
  | 'cashier'
  | 'pharmacist'
  | 'lab_technician'
  | 'radiologist'
  | 'nurse'
  | 'staff';

export type Locale = 'uz-Latn' | 'uz-Cyrl' | 'ru' | 'kk' | 'ky' | 'tg' | 'en';

export type OrganizationType = 'clinic' | 'hospital' | 'diagnostic_center' | 'dental' | 'laboratory' | 'pharmacy';
