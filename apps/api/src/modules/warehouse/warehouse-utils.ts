export const WAREHOUSE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

export function warehouseHostname(slug: string, baseDomain = 'sklad.clary.uz'): string {
  const normalizedSlug = slug.trim().toLowerCase();
  const normalizedDomain = baseDomain.trim().toLowerCase();

  if (!WAREHOUSE_SLUG_PATTERN.test(normalizedSlug)) {
    throw new Error('Warehouse slug must contain lowercase letters, numbers, or internal hyphens.');
  }
  if (
    normalizedDomain.length > 253 ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      normalizedDomain,
    )
  ) {
    throw new Error('WAREHOUSE_BASE_DOMAIN must be a valid DNS hostname.');
  }

  return `${normalizedSlug}.${normalizedDomain}`;
}

export function warehouseDatabaseNames(tenantId: string): {
  databaseName: string;
  databaseRole: string;
} {
  const compactId = tenantId.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compactId)) {
    throw new Error('Invalid warehouse tenant UUID.');
  }
  const suffix = compactId;
  return {
    databaseName: `clary_wh_${suffix}`,
    databaseRole: `clary_role_${suffix}`,
  };
}

export function quotePostgresIdentifier(value: string): string {
  if (!value || value.includes('\0')) throw new Error('Invalid PostgreSQL identifier.');
  return `"${value.replace(/"/g, '""')}"`;
}
