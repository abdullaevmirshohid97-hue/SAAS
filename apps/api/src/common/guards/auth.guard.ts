import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { getContextSafe } from '../context/request-context';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const header = req.headers['authorization'] ?? '';
    const [type, token] = header.split(' ');
    if (type !== 'Bearer' || !token) throw new UnauthorizedException('Missing bearer token');

    let payload: {
      sub: string;
      app_metadata?: { clinic_id?: string; role?: string; impersonated_by?: string };
    };
    try {
      payload = this.jwt.verify(token, {
        secret: process.env.SUPABASE_JWT_SECRET,
        audience: process.env.API_JWT_AUDIENCE ?? 'authenticated',
      });
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    const context = getContextSafe();
    if (context) {
      context.userId = payload.sub;
      context.clinicId = payload.app_metadata?.clinic_id ?? null;
      context.role = payload.app_metadata?.role ?? 'staff';
      context.impersonatedBy = payload.app_metadata?.impersonated_by ?? null;
    }
    return true;
  }
}
