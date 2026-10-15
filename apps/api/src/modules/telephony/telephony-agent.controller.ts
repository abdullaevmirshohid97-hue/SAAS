import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';

import { Public } from '../../common/decorators/public.decorator';
import { assertVoiceAgentKey } from '../ai-reception/voice-agent-auth';

import { PbxService } from './pbx.service';

// =============================================================================
// voice-agent (Asterisk serveri) ↔ API — bulutli ATS
// =============================================================================
//   GET  /telephony/agent/config     — barcha yoqilgan klinikalar: trunk + ichki raqamlar
//   POST /telephony/agent/status     — trunk registratsiyasi, onlayn telefonlar
//   POST /telephony/agent/call       — qo'ng'iroq tugadi (CDR)
//   POST /telephony/agent/recording  — yozuv (xom audio/wav tanasi, ?tenant=&uuid=)
// Himoya: `x-voice-agent-key` = VOICE_AGENT_SECRET (AI qabulxona bilan bir xil).
// =============================================================================

const StatusSchema = z.object({
  registrations: z
    .array(z.object({ endpoint: z.string().max(80), status: z.string().max(80) }))
    .max(2000),
  contacts: z.array(z.object({ aor: z.string().max(80), status: z.string().max(80) })).max(20000),
});

const CallSchema = z.object({
  uuid: z.string().min(8).max(64),
  tenant: z.string().regex(/^[a-z][a-z0-9]{2,15}$/),
  direction: z.enum(['in', 'out', 'internal']),
  from: z.string().max(80).nullish(),
  to: z.string().max(80).nullish(),
  dial_status: z.string().max(40).nullish(),
  peer: z.string().max(200).nullish(),
  started: z.number().nonnegative().nullish(),
  ended: z.number().nonnegative().nullish(),
  answered: z.number().min(-1).max(86_400).nullish(),
  ai: z.boolean().optional(),
  xfer: z.boolean().optional(),
  recording_path: z.string().max(300).nullish(),
  hangup_cause: z.string().max(40).nullish(),
});

/** 8 kHz WAV ≈ 1 MB/daqiqa — 90 daqiqalik suhbatgacha. */
const MAX_RECORDING_BYTES = 95 * 1024 * 1024;

function readRaw(req: Request, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new PayloadTooLargeException('Yozuv juda katta'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

@ApiTags('telephony-agent')
@Controller({ path: 'telephony/agent', version: '1' })
export class TelephonyAgentController {
  constructor(private readonly pbx: PbxService) {}

  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 300 } })
  @Get('config')
  config(@Headers('x-voice-agent-key') key?: string) {
    assertVoiceAgentKey(key);
    return this.pbx.agentConfig();
  }

  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 300 } })
  @Post('status')
  status(@Headers('x-voice-agent-key') key: string | undefined, @Body() body: unknown) {
    assertVoiceAgentKey(key);
    return this.pbx.agentStatus(StatusSchema.parse(body));
  }

  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 3000 } })
  @Post('call')
  call(@Headers('x-voice-agent-key') key: string | undefined, @Body() body: unknown) {
    assertVoiceAgentKey(key);
    return this.pbx.agentCall(CallSchema.parse(body));
  }

  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 1200 } })
  @Post('recording')
  async recording(
    @Headers('x-voice-agent-key') key: string | undefined,
    @Query('tenant') tenant: string | undefined,
    @Query('uuid') uuid: string | undefined,
    @Req() req: Request,
  ) {
    assertVoiceAgentKey(key);
    if (!tenant || !/^[a-z][a-z0-9]{2,15}$/.test(tenant)) throw new BadRequestException('tenant');
    if (!uuid) throw new BadRequestException('uuid');
    const type = String(req.headers['content-type'] ?? '');
    if (!/^(audio\/(wav|x-wav|wave)|application\/octet-stream)/i.test(type)) {
      throw new BadRequestException('Content-Type: audio/wav kerak');
    }
    const wav = await readRaw(req, MAX_RECORDING_BYTES);
    return this.pbx.agentRecording(tenant, uuid, wav);
  }
}
