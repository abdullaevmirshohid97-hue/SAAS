import { describe, it, expect } from 'vitest';
import { CreatePatientSchema } from '@clary/schemas';

describe('patients schema', () => {
  it('requires full_name', () => {
    expect(() => CreatePatientSchema.parse({ full_name: 'a' })).toThrow();
    expect(() => CreatePatientSchema.parse({ full_name: 'Alisher' })).not.toThrow();
  });
});
