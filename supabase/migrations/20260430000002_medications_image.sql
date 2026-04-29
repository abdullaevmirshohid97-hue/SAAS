-- Add image support to medications
ALTER TABLE medications ADD COLUMN IF NOT EXISTS image_url TEXT;
