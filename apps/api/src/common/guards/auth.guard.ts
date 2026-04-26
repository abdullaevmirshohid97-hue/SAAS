import { createPublicKey } from 'node:crypto';

import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { getContextSafe } from '../context/request-context';

type JwksKey = { kty: string; kid: string; use?: string; alg?: string; n?: string; e?: string; x?: string; y?: string; crv?: string };

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly log = new Logger(AuthGuard.name);
  private jwksCache: Map<string, string> = new Map(); // kid -> PEM public key
  private jwksCachedAt = 0;
  private readonly JWKS_TTL_MS = 5 * 60 * 1000;

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  private async getPublicKey(kid: string): Promise<string | null> {
    const now = Date.now();
    if (now - this.jwksCachedAt > this.JWKS_TTL_MS) {
      await this.refreshJwks();
    }
    return this.jwksCache.get(kid) ?? null;
  }

  private async refreshJwks(): Promise<void> {
    const supabaseUrl = process.env.SUPABASE_URL ?? '';
    const jwksUrl = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
    try {
      const res = await fetch(jwksUrl);
      const json = (await res.json()) as { keys?: JwksKey[] };
      this.jwksCache.clear();
      for (const key of json.keys ?? []) {
        const pem = createPublicKey({ key, format: 'jwk' }).export({ type: 'spki', format: 'pem' }) as string;
        this.jwksCache.set(key.kid, pem);
      }
      this.jwksCachedAt = Date.now();
    } catch (err) {
      this.log.warn(`Failed to refresh JWKS: ${(err as Error).message}`);
    }
  }

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
      // Decode header to get kid and alg without verifying
      const [rawHeader] = token.split('.');
      const header = JSON.parse(Buffer.from(rawHeader, 'base64url').toString()) as { kid?: string; alg?: string };

      if (header.alg === 'HS256') {
        // Legacy shared-secret tokens
        payload = this.jwt.verify(token, {
          secret: process.env.SUPABASE_JWT_SECRET,
          audience: process.env.API_JWT_AUDIENCE ?? 'authenticated',
        });
      } else if (header.kid) {
        // ECC / RSA tokens — verify via JWKS public key
        const publicKey = await this.getPublicKey(header.kid);
        if (!publicKey) throw new Error(`Unknown kid: ${header.kid}`);
        payload = this.jwt.verify(token, {
          publicKey,
          algorithms: ['ES256', 'RS256'],
          audience: process.env.API_JWT_AUDIENCE ?? 'authenticated',
        });
      } else {
        throw new Error('Cannot determine verification method');
      }
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
