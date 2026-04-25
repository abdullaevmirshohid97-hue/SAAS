import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
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

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
