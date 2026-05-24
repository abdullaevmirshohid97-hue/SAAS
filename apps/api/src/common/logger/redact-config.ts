// PHI (Protected Health Information) redaction config for Pino logger.
// HIPAA compliance: bemor ma'lumotlari log fayllarda yozilmasin.
//
// Pino `redact` path syntax: dotted yoki bracket paths.
// '*.field' bo'lsa har qanday darajadagi field ushlanadi.

export const PHI_REDACT_PATHS: string[] = [
  // Asosiy PHI maydonlar
  '*.patient_name',
  '*.patient_phone',
  '*.patient_email',
  '*.patient_dob',
  '*.patient_address',
  '*.patient_passport',
  '*.full_name',
  '*.first_name',
  '*.last_name',
  '*.middle_name',
  '*.patronymic',
  '*.phone',
  '*.email',
  '*.dob',
  '*.date_of_birth',
  '*.passport',
  '*.passport_series',
  '*.passport_number',
  '*.address',
  '*.notes',

  // Auth/secret maydonlar
  'req.body.password',
  'req.body.access_token',
  'req.body.refresh_token',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-supabase-key"]',
  'res.headers["set-cookie"]',
];

export const REDACT_REPLACEMENT = '[REDACTED]';
