import { Body, Controller, Headers, Ip, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../../common/decorators/public.decorator';

import { DemoService } from './demo.service';

@ApiTags('demo')
@Controller('demo')
export class DemoController {
  constructor(private readonly svc: DemoService) {}

  @Public()
  @Throttle({ public: { ttl: 60 * 60 * 1000, limit: 3 } })
  @Post('spawn')
  async spawn(
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Body() body: { fingerprint?: string },
  ) {
    return this.svc.spawn({
      ip,
      userAgent: userAgent ?? null,
      fingerprint: body?.fingerprint ?? null,
    });
  }

  @Public()
  @Post('cleanup')
  async cleanup(@Headers('x-cron-secret') secret: string | undefined) {
    return this.svc.cleanup(secret);
  }
}
