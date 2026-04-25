/**
 * Clary v2 — RBAC permissions catalog (SSOT)
 *
 * This file is the canonical source for permission keys consumed by BOTH the
 * API (`@RequirePerm('module.action')`) and the frontend (`<Can perm="...">`).
 *
 * It must stay in sync with the DB table `permissions_catalog` (seeded by
 * migration `20260424001070_permissions_catalog.sql`). When you add a new
 * permission here:
 *  1. Add the row in the migration seed (same key, module, action, roles)
 *  2. Bump `PERMISSIONS_CATALOG_VERSION` below
 *  3. Update any @RequirePerm decorator calls on new endpoints
 */

export const PERMISSIONS_CATALOG_VERSION = '2.0.0';

/**
 * module → action[] catalog. Keys are `${module}.${action}`.
 */
export const PERMISSION_MODULES = {
  patients:      ['view', 'create', 'edit', 'delete', 'export', 'view_phi'],
  appointments:  ['view', 'create', 'edit', 'cancel', 'reschedule'],
  queue:         ['view', 'call_next', 'reassign', 'skip'],
  doctor_view:   ['view', 'create_soap', 'edit_soap', 'sign_note'],
  prescriptions: ['view', 'create', 'edit', 'cancel'],
  lab:           ['view', 'create_order', 'collect_sample', 'enter_result', 'report_result', 'cancel_order'],
  diagnostics:   ['view', 'create_order', 'perform', 'report', 'manage_equipment'],
  dental:        ['view', 'edit_chart', 'manage_plan'],
  pharmacy:      ['view', 'dispense', 'receive_stock', 'edit_stock', 'adjust'],
  medications:   ['view', 'create', 'edit', 'edit_price', 'delete'],
  cashier:       ['view', 'accept_payment', 'refund', 'void', 'close_shift', 'view_all_shifts'],
  inpatient:     ['view', 'admit', 'discharge', 'transfer_bed'],
  nurse:         ['view_tasks', 'complete_task', 'emergency_broadcast'],
  home_nurse:    ['view', 'accept_request', 'assign_nurse', 'manage_tariffs'],
  marketing:     ['view', 'create_campaign', 'send_campaign', 'manage_segments', 'manage_loyalty'],
  analytics:     ['view_self', 'view_clinic', 'export'],
  payroll:       ['view_own', 'view_all', 'pay_salary', 'manage_rates'],
  staff:         ['view', 'invite', 'edit', 'deactivate', 'manage_roles', 'manage_permissions'],
  settings:      ['view', 'edit_clinic', 'edit_branding', 'manage_integrations', 'manage_catalog', 'manage_online_queue'],
  audit:         ['view'],
  support:       ['view', 'send_message'],
} as const;

export type PermissionModule = keyof typeof PERMISSION_MODULES;

type ActionsOf<M extends PermissionModule> =
  (typeof PERMISSION_MODULES)[M][number];

export type PermissionKey = {
  [M in PermissionModule]: `${M}.${ActionsOf<M>}`;
}[PermissionModule];

/** All permission keys as a string[] at runtime. */
export const ALL_PERMISSIONS: PermissionKey[] = Object.entries(PERMISSION_MODULES).flatMap(
  ([mod, actions]) => (actions as readonly string[]).map((a) => `${mod}.${a}` as PermissionKey),
);

/**
 * Dangerous permissions — UI should show a confirmation dialog and audit
 * logs should be emitted with higher severity.
 */
export const DANGEROUS_PERMISSIONS: ReadonlySet<PermissionKey> = new Set<PermissionKey>([
  'patients.delete',
  'pharmacy.edit_stock',
  'pharmacy.adjust',
  'medications.delete',
  'cashier.refund',
  'cashier.void',
  'marketing.send_campaign',
  'payroll.pay_salary',
  'staff.deactivate',
  'staff.manage_roles',
  'staff.manage_permissions',
]);

/**
 * Default permissions per base role. These are applied unless a custom role
 * (`custom_roles.permissions`) or a per-user override (`permissions_override`)
 * says otherwise.
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<string, PermissionKey[]> = {
  clinic_owner: ALL_PERMISSIONS,
  clinic_admin: ALL_PERMISSIONS,
  doctor: [
    'patients.view', 'patients.create', 'patients.edit', 'patients.view_phi',
    'appointments.view', 'appointments.create', 'appointments.edit', 'appointments.cancel', 'appointments.reschedule',
    'queue.view', 'queue.call_next', 'queue.skip',
    'doctor_view.view', 'doctor_view.create_soap', 'doctor_view.edit_soap', 'doctor_view.sign_note',
    'prescriptions.view', 'prescriptions.create', 'prescriptions.edit', 'prescriptions.cancel',
    'lab.view', 'lab.create_order', 'lab.report_result', 'lab.cancel_order',
    'diagnostics.view', 'diagnostics.create_order', 'diagnostics.report',
    'dental.view', 'dental.edit_chart', 'dental.manage_plan',
    'inpatient.view', 'inpatient.admit', 'inpatient.discharge', 'inpatient.transfer_bed',
    'analytics.view_self',
    'payroll.view_own',
    'audit.view',
    'support.view', 'support.send_message',
  ],
  receptionist: [
    'patients.view', 'patients.create', 'patients.edit',
    'appointments.view', 'appointments.create', 'appointments.edit', 'appointments.cancel', 'appointments.reschedule',
    'queue.view', 'queue.call_next', 'queue.reassign', 'queue.skip',
    'cashier.view', 'cashier.accept_payment', 'cashier.close_shift',
    'inpatient.view', 'inpatient.admit',
    'home_nurse.view', 'home_nurse.accept_request',
    'support.view', 'support.send_message',
  ],
  cashier: [
    'patients.view',
    'cashier.view', 'cashier.accept_payment', 'cashier.close_shift',
    'pharmacy.view',
    'medications.view',
    'analytics.view_self',
    'payroll.view_own',
    'support.view', 'support.send_message',
  ],
  pharmacist: [
    'patients.view',
    'pharmacy.view', 'pharmacy.dispense', 'pharmacy.receive_stock', 'pharmacy.edit_stock',
    'medications.view', 'medications.create', 'medications.edit',
    'prescriptions.view',
    'payroll.view_own',
    'support.view', 'support.send_message',
  ],
  lab_technician: [
    'patients.view',
    'lab.view', 'lab.create_order', 'lab.collect_sample', 'lab.enter_result', 'lab.report_result',
    'payroll.view_own',
    'support.view', 'support.send_message',
  ],
  radiologist: [
    'patients.view',
    'diagnostics.view', 'diagnostics.perform', 'diagnostics.report',
    'lab.view',
    'payroll.view_own',
    'support.view', 'support.send_message',
  ],
  nurse: [
    'patients.view',
    'queue.view', 'queue.call_next',
    'appointments.view',
    'inpatient.view', 'inpatient.transfer_bed',
    'nurse.view_tasks', 'nurse.complete_task', 'nurse.emergency_broadcast',
    'home_nurse.view',
    'lab.view', 'lab.collect_sample',
    'prescriptions.view',
    'payroll.view_own',
    'support.view', 'support.send_message',
  ],
  staff: [
    'patients.view',
    'appointments.view',
    'queue.view',
    'support.view', 'support.send_message',
  ],
};

/**
 * Compute the effective permission map for a user given their role, custom
 * role overrides, and per-user overrides. Later entries win; `false` in an
 * override is an explicit DENY.
 */
export function computeEffectivePermissions(input: {
  role: string;
  customRolePermissions?: Record<string, boolean> | null;
  permissionsOverride?: Record<string, boolean> | null;
}): Record<PermissionKey, boolean> {
  const map: Record<string, boolean> = {};
  const defaults = ROLE_DEFAULT_PERMISSIONS[input.role] ?? [];
  for (const key of ALL_PERMISSIONS) map[key] = false;
  for (const key of defaults) map[key] = true;
  if (input.customRolePermissions) {
    for (const [k, v] of Object.entries(input.customRolePermissions)) {
      map[k] = Boolean(v);
    }
  }
  if (input.permissionsOverride) {
    for (const [k, v] of Object.entries(input.permissionsOverride)) {
      map[k] = Boolean(v);
    }
  }
  return map as Record<PermissionKey, boolean>;
}

/**
 * Check whether a permission map satisfies ALL the required permissions.
 */
export function hasAllPermissions(
  map: Partial<Record<PermissionKey, boolean>>,
  required: PermissionKey[],
): boolean {
  return required.every((k) => map[k] === true);
}

/**
 * Check whether a permission map satisfies ANY of the required permissions.
 */
export function hasAnyPermission(
  map: Partial<Record<PermissionKey, boolean>>,
  required: PermissionKey[],
): boolean {
  return required.some((k) => map[k] === true);
}

/**
 * Preset role templates shown in the Clinic Settings → Staff UI so admins
 * can one-click apply sensible defaults.
 */
export const PERMISSION_PRESETS: Array<{
  code: string;
  label_i18n: Record<string, string>;
  base_role: string;
  permissions: PermissionKey[];
}> = [
  {
    code: 'reception_junior',
    label_i18n: {
      'uz-Latn': 'Qabulxona (kichik)',
      ru: 'Приёмная (младший)',
      en: 'Reception (junior)',
    },
    base_role: 'receptionist',
    permissions: [
      'patients.view', 'patients.create',
      'appointments.view', 'appointments.create', 'appointments.reschedule',
      'queue.view', 'queue.call_next',
      'support.view', 'support.send_message',
    ],
  },
  {
    code: 'pharmacy_operator',
    label_i18n: {
      'uz-Latn': 'Dorixona operatori',
      ru: 'Оператор аптеки',
      en: 'Pharmacy operator',
    },
    base_role: 'pharmacist',
    permissions: [
      'patients.view',
      'pharmacy.view', 'pharmacy.dispense',
      'medications.view',
      'prescriptions.view',
      'support.view', 'support.send_message',
    ],
  },
  {
    code: 'doctor_limited',
    label_i18n: {
      'uz-Latn': 'Shifokor (chekli)',
      ru: 'Врач (ограниченный)',
      en: 'Doctor (limited)',
    },
    base_role: 'doctor',
    permissions: [
      'patients.view', 'patients.view_phi',
      'appointments.view',
      'queue.view', 'queue.call_next',
      'doctor_view.view', 'doctor_view.create_soap', 'doctor_view.sign_note',
      'lab.view',
      'diagnostics.view',
      'payroll.view_own',
      'support.view', 'support.send_message',
    ],
  },
  {
    code: 'nurse_home_visit',
    label_i18n: {
      'uz-Latn': 'Hamshira (uy xizmati)',
      ru: 'Медсестра (на дому)',
      en: 'Nurse (home visits)',
    },
    base_role: 'nurse',
    permissions: [
      'patients.view',
      'nurse.view_tasks', 'nurse.complete_task',
      'home_nurse.view',
      'prescriptions.view',
      'payroll.view_own',
      'support.view', 'support.send_message',
    ],
  },
];
