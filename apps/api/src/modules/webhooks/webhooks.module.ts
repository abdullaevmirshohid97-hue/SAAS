import { Body, Controller, Headers, Module, Post, RawBodyRequest, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '../../common/decorators/public.decorator';

@ApiTags('webhooks')
@Controller('webhooks')
class WebhooksController {
  @Public()
  @Post('stripe')
  stripe(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') sig: string) {
    // Real impl: verify via stripe.webhooks.constructEvent + process event
    return { received: true, hasSignature: Boolean(sig) };
  }

  @Public()
  @Post('click')
  click(@Body() body: unknown) {
    return { received: true, body };
  }

  @Public()
  @Post('payme')
  payme(@Body() body: unknown) {
    return { received: true, body };
  }

  @Public()
  @Post('uzum')
  uzum(@Body() body: unknown) {
    return { received: true, body };
  }
}

@Module({ controllers: [WebhooksController] })
export class WebhooksModule {}
