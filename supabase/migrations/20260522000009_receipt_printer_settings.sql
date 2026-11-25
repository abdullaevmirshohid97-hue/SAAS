-- =============================================================================
-- Clary v2 — Migration: chek printer sozlamalari
--
-- Klinika o'z chek qog'ozini sozlashi mumkin:
--   * Qog'oz kengligi (58mm / 80mm)
--   * Shrift turi (monospace / sans-serif / serif)
--   * Shrift hajmi
--   * Qalin/ingichka
--   * Bosh sarlavha (brend nom)
--   * Shior (tag line)
--   * QR kod (havola yoki matn)
--   * Tranzaksiya ID ko'rsatish (true/false)
-- =============================================================================

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS receipt_settings JSONB NOT NULL DEFAULT '{
    "paper_width": "80mm",
    "font_family": "monospace",
    "font_size": 12,
    "font_weight": "normal",
    "brand_name": null,
    "slogan": null,
    "qr_text": null,
    "qr_enabled": false,
    "show_transaction_id": false,
    "footer_note": "Rahmat! Sog''ligingizga shifo tilaymiz!"
  }'::jsonb;

COMMENT ON COLUMN clinics.receipt_settings IS
  'Chek printer sozlamalari: qog''oz kengligi, shrift, brend, QR va boshqalar.';
