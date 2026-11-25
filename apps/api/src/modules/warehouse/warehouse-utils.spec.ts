import { describe, expect, it } from 'vitest';

import {
  quotePostgresIdentifier,
  warehouseDatabaseNames,
  warehouseHostname,
} from './warehouse-utils';

describe('warehouse tenant utilities', () => {
  it('builds a tenant hostname under the configured warehouse base domain', () => {
    expect(warehouseHostname('company-01', 'sklad.clary.uz')).toBe('company-01.sklad.clary.uz');
  });

  it('rejects malformed slugs and hostnames', () => {
    expect(() => warehouseHostname('../clinic', 'sklad.clary.uz')).toThrow();
    expect(() => warehouseHostname('admin', 'sklad.clary.uz')).toThrow();
    expect(() => warehouseHostname('company', 'not a domain')).toThrow();
  });

  it('generates deterministic database identifiers from a tenant UUID', () => {
    expect(warehouseDatabaseNames('12345678-1234-1234-1234-123456789abc')).toEqual({
      databaseName: 'clary_wh_12345678123412341234123456789abc',
      databaseRole: 'clary_role_12345678123412341234123456789abc',
    });
  });

  it('quotes PostgreSQL identifiers safely', () => {
    expect(quotePostgresIdentifier('tenant"name')).toBe('"tenant""name"');
    expect(() => quotePostgresIdentifier('bad\0name')).toThrow();
  });
});

describe('provisioning queue policy', () => {
  it('backoff ikki baravar oshadi va 15 daqiqadan oshmaydi', async () => {
    const { provisioningBackoffMs } = await import('./warehouse-utils');
    expect(provisioningBackoffMs(1)).toBe(15_000);
    expect(provisioningBackoffMs(2)).toBe(30_000);
    expect(provisioningBackoffMs(3)).toBe(60_000);
    expect(provisioningBackoffMs(20)).toBe(15 * 60_000);
    expect(provisioningBackoffMs(0)).toBe(15_000);
  });

  it('oxirgi urinishgacha PENDING, keyin FAILED', async () => {
    const { provisioningFailureState, WAREHOUSE_MAX_ATTEMPTS } = await import('./warehouse-utils');
    expect(provisioningFailureState(1)).toBe('PENDING');
    expect(provisioningFailureState(WAREHOUSE_MAX_ATTEMPTS - 1)).toBe('PENDING');
    expect(provisioningFailureState(WAREHOUSE_MAX_ATTEMPTS)).toBe('FAILED');
  });

  it('log matnidan ulanish satri va parol olib tashlanadi', async () => {
    const { redactInfraError } = await import('./warehouse-utils');
    const msg = redactInfraError(
      new Error(
        "connect failed postgresql://clary_role_x:S3cr3t@db.internal:5432/x; ALTER ROLE r PASSWORD 'abc' password=hunter2",
      ),
    );
    expect(msg).not.toContain('S3cr3t');
    expect(msg).not.toContain('abc');
    expect(msg).not.toContain('hunter2');
    expect(msg).toContain('[redacted]');
  });
});
