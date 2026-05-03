-- =============================================================================
-- Patch: enable RLS on support_* tables (policies were created by prior migration
-- but ALTER TABLE ENABLE ROW LEVEL SECURITY was missed).
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'support_canned_responses') THEN
    EXECUTE 'ALTER TABLE public.support_canned_responses ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'support_typing_indicators') THEN
    EXECUTE 'ALTER TABLE public.support_typing_indicators ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
