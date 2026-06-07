-- Aralash (split) to'lov uchun payment_method_type enum'ga 'mixed' qiymati.
-- Bir tranzaksiya bir nechta usulda to'langanda (naqd + karta) transactions.payment_method='mixed'
-- bo'ladi, haqiqiy bo'laklar transaction_payments jadvalida saqlanadi.
-- Alohida migration: ADD VALUE qiymati keyingi migrationда ishlatilishi uchun commit bo'lishi shart.
ALTER TYPE payment_method_type ADD VALUE IF NOT EXISTS 'mixed';
