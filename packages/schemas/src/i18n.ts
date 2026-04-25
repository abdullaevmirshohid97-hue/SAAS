import { z } from 'zod';

export const LocaleEnum = z.enum(['uz-Latn', 'uz-Cyrl', 'ru', 'kk', 'ky', 'tg', 'en']);
export type Locale = z.infer<typeof LocaleEnum>;

export const I18nTextSchema = z.record(LocaleEnum, z.string());
export type I18nText = z.infer<typeof I18nTextSchema>;
