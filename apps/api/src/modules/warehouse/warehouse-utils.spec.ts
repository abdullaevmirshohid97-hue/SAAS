import { describe, expect, it } from 'vitest';

import {
  quotePostgresIdentifier,
  warehouseDatabaseNames,
  warehouseHostname,
} from './warehouse-utils';

describe('warehouse tenant utilities', () => {
  it('builds a tenant hostname under the configured warehouse base domain', () => {
    expect(warehouseHostname('company-01', 'sklad.clary.uz')).toBe(
      'company-01.sklad.clary.uz',
    );
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
