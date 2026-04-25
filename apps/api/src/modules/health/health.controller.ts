import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  @Public()
  @Get('health')
  @HealthCheck()
  check() {
    return this.health.check([
      async () => ({ api: { status: 'up' } }),
    ]);
  }

  @Public()
  @Get('/')
  root() {
    return { name: 'Clary API', version: '1.0.0', docs: '/api/docs' };
  }
}
