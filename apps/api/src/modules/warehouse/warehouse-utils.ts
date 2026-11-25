export const WAREHOUSE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const RESERVED_WAREHOUSE_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'auth',
  'cdn',
  'static',
  'status',
  'support',
  'www',
]);

export function warehouseHostname(slug: string, baseDomain = 'sklad.clary.uz'): string {
  const normalizedSlug = slug.trim().toLowerCase();
  const normalizedDomain = baseDomain.trim().toLowerCase();

  if (
    !WAREHOUSE_SLUG_PATTERN.test(normalizedSlug) ||
    RESERVED_WAREHOUSE_SLUGS.has(normalizedSlug)
  ) {
    throw new Error('Warehouse slug must contain lowercase letters, numbers, or internal hyphens.');
  }
  if (
    normalizedDomain.length > 253 ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalizedDomain)
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

/** Nechanchi urinishdan keyin FAILED (Super Admin "Qayta urinish" bosguncha). */
export const WAREHOUSE_MAX_ATTEMPTS = 5;

/**
 * Keyingi urinishgacha kutish (ms): 15 s, 30 s, 1 min, 2 min, … ko'pi bilan 15 min.
 * `attempt` — hozir tugagan urinish raqami (1 dan).
 */
export function provisioningBackoffMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(15_000 * 2 ** (n - 1), 15 * 60_000);
}

/** Urinish xato bilan tugadi — keyingi holat. */
export function provisioningFailureState(attempt: number): 'PENDING' | 'FAILED' {
  return attempt >= WAREHOUSE_MAX_ATTEMPTS ? 'FAILED' : 'PENDING';
}

/**
 * Xato matnidan ulanish satri va parollarni olib tashlaydi — server logiga
 * yozish uchun (bazaga/Super Admin'ga baribir faqat umumiy xabar boradi).
 */
export function redactInfraError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgresql://[redacted]')
    .replace(/(password\s*[=:]\s*)\S+/gi, '$1[redacted]')
    .replace(/PASSWORD\s+'[^']*'/gi, "PASSWORD '[redacted]'")
    .slice(0, 500);
}
