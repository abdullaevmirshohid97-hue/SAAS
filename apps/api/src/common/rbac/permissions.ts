/**
 * API-side re-export of the shared RBAC permissions catalog.
 *
 * The source of truth lives in `@clary/schemas/permissions` so both the NestJS
 * API (@RequirePerm) and the React frontends (<Can>) can share the same
 * typed keys.
 */
export {
  PERMISSIONS_CATALOG_VERSION,
  PERMISSION_MODULES,
  ALL_PERMISSIONS,
  DANGEROUS_PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  PERMISSION_PRESETS,
  computeEffectivePermissions,
  hasAllPermissions,
  hasAnyPermission,
  // Maydon darajasidagi xavfsizlik (field-security.ts)
  PROTECTED_FIELDS,
  PROTECTED_FIELD_KEYS,
  defaultFieldPermissions,
  hiddenFieldsFor,
  type ProtectedField,
  type PermissionKey,
  type PermissionModule,
} from '@clary/schemas';
