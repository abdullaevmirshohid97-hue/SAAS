import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

/**
 * voice-agent (Asterisk serveridagi xizmat) so'rovlarini tekshirish:
 * `x-voice-agent-key` sarlavhasi = VOICE_AGENT_SECRET (kamida 24 belgi).
 * AI qabulxona (voice/*) va bulutli ATS (telephony/agent/*) bir xil kalitdan foydalanadi.
 */
export function assertVoiceAgentKey(key: string | undefined): void {
  const secret = process.env.VOICE_AGENT_SECRET ?? '';
  if (secret.length < 24) {
    throw new ServiceUnavailableException('VOICE_AGENT_SECRET sozlanmagan (kamida 24 belgi)');
  }
  const a = Buffer.from(key ?? '');
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
}
