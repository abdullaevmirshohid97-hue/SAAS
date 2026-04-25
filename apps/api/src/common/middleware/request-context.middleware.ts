import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { requestContextStorage } from '../context/request-context';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = (req.header('X-Request-Id') ?? randomUUID()).toString();
    res.setHeader('X-Request-Id', requestId);

    requestContextStorage.run(
      {
        requestId,
        userId: null,
        clinicId: null,
        role: 'anonymous',
        ip: req.ip ?? req.header('X-Real-IP') ?? null,
        userAgent: req.header('user-agent') ?? null,
        idempotencyKey: req.header('Idempotency-Key') ?? null,
      },
      () => next(),
    );
  }
}
