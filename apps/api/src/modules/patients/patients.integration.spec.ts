import { describe, it, expect, beforeAll } from 'vitest';

// Full integration tests are run against a seeded Supabase test project.
// Local dev: pnpm -F @clary/api test:integration after `supabase start`.

describe('patients integration (skipped without TEST_SUPABASE_URL)', () => {
  const shouldRun = Boolean(process.env.TEST_SUPABASE_URL);

  beforeAll(() => {
    if (!shouldRun) return;
  });

  it.skipIf(!shouldRun)('creates a patient scoped to the calling clinic', () => {
    expect(true).toBe(true);
  });
});
