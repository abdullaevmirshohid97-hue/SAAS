-- =============================================================================
-- Clary v2 — Migration: payment_method 'debt' qiymati
--
-- Maqsad: qabulxonada bemor to'liq qarz bilan ketsa, payment_method='debt'
-- deb yoziladi. Jurnalda alohida 'Qarz' badge bilan ko'rinadi.
-- =============================================================================

ALTER TYPE payment_method_type ADD VALUE IF NOT EXISTS 'debt';
