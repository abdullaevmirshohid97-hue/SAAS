import {
  Controller,
  Get,
  MiddlewareConsumer,
  Module,
  NestModule,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { Public } from '../../common/decorators/public.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RequestContextMiddleware } from '../../common/middleware/request-context.middleware';
import { SupabaseService } from '../../common/services/supabase.service';
import { WarehouseModule } from './warehouse.module';
import { WarehouseService } from './warehouse.service';

// =============================================================================
// CLARY Sklad API — ALOHIDA Nest ilovasi (sklad-main.ts, pm2: clary-sklad-api).
// =============================================================================
// CLARY Clinic AppModule'dan mustaqil: Clinic'ning tenant/obuna/tarif/dorixona/
// ruxsat guard'lari bu yerda YO'Q (Sklad'ning o'z a'zolik qoidasi bor), Clinic
// API esa Sklad kodini umuman yuklamaydi. Umumiy faqat: Supabase identifikatsiya
// (JWT tekshiruvi — AuthGuard) va control-plane jadvallari.
// =============================================================================

@Controller()
class SkladHealthController {
  constructor(private readonly warehouse: WarehouseService) {}

  @Public()
  @Get('health')
  health() {
    return { status: 'ok', service: 'clary-sklad-api' };
  }

  /** Caddy on_demand_tls 'ask': 200 — sertifikat berilsin, 404 — yo'q. */
  @Public()
  @Get('tls-allowed')
  async tlsAllowed(@Query('domain') domain?: string) {
    if (!(await this.warehouse.isTlsAllowedHost(domain ?? ''))) throw new NotFoundException();
    return { ok: true };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env.local' }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 600 }]),
    WarehouseModule,
  ],
  controllers: [SkladHealthController],
  providers: [
    SupabaseService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class SkladAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
