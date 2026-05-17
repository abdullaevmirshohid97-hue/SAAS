import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

const STARTED_AT = Date.now();

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly supabase: SupabaseService,
  ) {}

  /** Liveness probe — UptimeRobot pings this. 200 = up, 503 = down. */
  @Public()
  @Get('health')
  @HealthCheck()
  check() {
    return this.health.check([
      async () => ({ api: { status: 'up' } }),
      async () => {
        const t0 = Date.now();
        const { error } = await this.supabase
          .admin()
          .from('clinics')
          .select('id', { head: true, count: 'exact' })
          .limit(1);
        const latencyMs = Date.now() - t0;
        if (error) {
          throw new Error(`db check failed: ${error.message}`);
        }
        return { database: { status: 'up', latencyMs } };
      },
    ]);
  }

  /** Public status snapshot — used by status.clary.uz. */
  @Public()
  @Get('status')
  async status() {
    const t0 = Date.now();
    let dbUp = true;
    let dbLatencyMs: number | null = null;
    try {
      const { error } = await this.supabase
        .admin()
        .from('clinics')
        .select('id', { head: true, count: 'exact' })
        .limit(1);
      dbLatencyMs = Date.now() - t0;
      dbUp = !error;
    } catch {
      dbUp = false;
    }
    const ok = dbUp;
    return {
      status: ok ? 'operational' : 'degraded',
      uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
      checkedAt: new Date().toISOString(),
      components: {
        api: { status: 'up' },
        database: { status: dbUp ? 'up' : 'down', latencyMs: dbLatencyMs },
      },
    };
  }

  @Public()
  @Get('/')
  root() {
    return { name: 'Clary API', version: '1.0.0', docs: '/api/docs' };
  }
}
