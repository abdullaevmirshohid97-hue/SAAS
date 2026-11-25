import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import helmet from 'helmet';

import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { SupabaseService } from './common/services/supabase.service';
import { SkladAppModule } from './modules/warehouse/sklad-app.module';

// =============================================================================
// CLARY Sklad API — alohida jarayon (pm2: clary-sklad-api, port SKLAD_API_PORT=4100)
// =============================================================================
// Caddy: sklad.clary.uz va <slug>.sklad.clary.uz → localhost:4100. Host sarlavhasi
// o'zgarmay keladi (kompaniya shundan aniqlanadi). Clinic API'ga (4000) tegmaydi:
// Sklad qulasa yoki qayta ishga tushsa ham klinikalar ishlayveradi.
// =============================================================================

/** admin.clary.uz (Super Admin) va kompaniya subdomenlari. */
export function skladCorsOrigin(baseDomain: string) {
  const escaped = baseDomain.replace(/[.]/g, '\.');
  const tenant = new RegExp(`^https://[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?\.${escaped}$`);
  const fixed = new Set([
    'https://admin.clary.uz',
    `https://${baseDomain}`,
    ...(process.env.SKLAD_CORS_ORIGINS ?? '').split(',').filter(Boolean),
  ]);
  return (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
    // Origin yo'q (curl, server→server) — CORS emas, ruxsat (auth baribir shart).
    if (!origin) return cb(null, true);
    if (fixed.has(origin) || tenant.test(origin)) return cb(null, true);
    if (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(origin)) {
      return cb(null, true);
    }
    return cb(null, false);
  };
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(SkladAppModule, {
    bufferLogs: true,
  });
  app.useBodyParser('json', { limit: '5mb' });

  const port = Number(process.env.SKLAD_API_PORT ?? 4100);
  const baseDomain = (process.env.WAREHOUSE_BASE_DOMAIN ?? 'sklad.clary.uz').toLowerCase();

  app.use(
    helmet({
      contentSecurityPolicy: false, // faqat JSON API — HTML berilmaydi
      strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.enableCors({
    origin: skladCorsOrigin(baseDomain),
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1', prefix: 'api/v' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter(app.get(SupabaseService)));
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.enableShutdownHooks();

  // Faqat lokal interfeys — tashqaridan faqat Caddy orqali.
  await app.listen(port, process.env.SKLAD_API_HOST ?? '127.0.0.1');
  console.info(
    `[clary-sklad-api] listening on ${process.env.SKLAD_API_HOST ?? '127.0.0.1'}:${port}`,
  );
}

if (require.main === module) {
  void bootstrap();
}
