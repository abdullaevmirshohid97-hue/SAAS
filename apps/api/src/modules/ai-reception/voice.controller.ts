import { BadRequestException, Body, Controller, Get, Headers, Logger, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { localDateOf } from '@clary/utils';

import { Public } from '../../common/decorators/public.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

import { normalizeUzPhone } from './booking.service';
import { ReceptionBrainService } from './brain.service';
import { AiReceptionSettingsService } from './settings.service';
import { assertVoiceAgentKey } from './voice-agent-auth';

// =============================================================================
// voice-agent ↔ API (telefon qo'ng'iroqlari)
// =============================================================================
// voice-agent (apps/voice-agent, Asterisk yonida) har qo'ng'iroqda:
//   POST /ai-reception/voice/start      — liniya → klinika, rejim, salomlashuv
//   POST /ai-reception/voice/turn       — bemor gapi (STT matni) → AI javobi
//   POST /ai-reception/voice/end        — yakun (davomiylik, xarajat)
//   POST /ai-reception/voice/recording  — yozuv (WAV, base64)
// Himoya: `x-voice-agent-key` = VOICE_AGENT_SECRET (kamida 24 belgi).
// =============================================================================

const StartSchema = z.object({
  external_id: z.string().max(100),
  line_key: z.string().max(100).nullish(),
  did: z.string().max(40).nullish(),
  caller: z.string().max(40).nullish(),
  diversion: z.string().max(300).nullish(),
});
const TurnSchema = z.object({
  call_id: z.string().uuid(),
  text: z.string().max(4000),
  alt_text_ru: z.string().max(4000).nullish(),
  stt_seconds: z.number().min(0).max(600).optional(),
});
const EndSchema = z.object({
  call_id: z.string().uuid(),
  duration_sec: z.number().int().min(0).max(7200).optional(),
  stt_seconds: z.number().min(0).max(7200).optional(),
  tts_chars: z.number().int().min(0).max(1_000_000).optional(),
  hangup_by: z.string().max(40).optional(),
  error: z.string().max(1000).nullish(),
  voicemail_transcript: z.string().max(4000).nullish(),
  has_recording: z.boolean().optional(),
});
const RecordingSchema = z.object({
  call_id: z.string().uuid(),
  // 8 kHz 16-bit mono WAV ≈ 16 KB/s → 6 daqiqa ≈ 5.8 MB → base64 ≈ 7.7 MB
  wav_base64: z.string().min(100).max(9_000_000),
});

@ApiTags('ai-reception-voice')
@Controller({ path: 'ai-reception/voice', version: '1' })
export class AiReceptionVoiceController {
  private readonly log = new Logger('AiReceptionVoice');

  constructor(
    private readonly supabase: SupabaseService,
    private readonly settings: AiReceptionSettingsService,
    private readonly brain: ReceptionBrainService,
  ) {}

  private auth(key: string | undefined) {
    assertVoiceAgentKey(key);
  }

  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 600 } })
  @Get('ping')
  ping(@Headers('x-voice-agent-key') key?: string) {
    this.auth(key);
    return { ok: true, model: this.brain.model, at: new Date().toISOString() };
  }

  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 600 } })
  @Post('start')
  async start(@Headers('x-voice-agent-key') key: string | undefined, @Body() body: unknown) {
    this.auth(key);
    const input = StartSchema.parse(body);
    const line = await this.settings.resolveLine(input.line_key ?? null, input.did ?? null);
    if (!line) {
      this.log.warn(`noma'lum liniya: endpoint=${input.line_key ?? '-'} did=${input.did ?? '-'}`);
      return { mode: 'reject', say: this.brain.rejectMessage, lang: 'uz' };
    }
    const clinicId = line.clinic_id;
    const s = await this.settings.get(clinicId);
    const clinic = await this.settings.clinicContext(clinicId);
    const caller = normalizeUzPhone(input.caller);
    // Bulutli ATS trunk liniyasi (trunk-<kod>): AI odamga ulasa — ichki qabulxona guruhiga
    const pbx = line.line_key.startsWith('trunk-');

    let mode: 'ai' | 'voicemail' | 'reject' = s.mode === 'off' ? 'reject' : s.mode;
    let reason: string | null = null;
    if (mode === 'ai' && !this.settings.aiEffective(s)) {
      mode = 'voicemail';
      reason = 'ai_not_allowed';
    }
    if (mode === 'ai' && s.monthly_call_limit > 0) {
      const used = await this.settings.monthlyAiCalls(clinicId);
      if (used >= s.monthly_call_limit) {
        mode = 'voicemail';
        reason = 'monthly_limit';
      }
    }
    if (mode === 'ai' && s.after_hours_mode === 'voicemail' && !this.settings.isOpenNow(clinic)) {
      mode = 'voicemail';
      reason = 'after_hours';
    }

    if (mode === 'reject') {
      return { mode, say: this.brain.rejectMessage, lang: 'uz' };
    }

    const greeting = mode === 'ai' ? this.brain.buildGreeting(s, clinic) : null;
    const { callId } = await this.brain.startSession({
      clinicId,
      channel: 'phone',
      mode,
      externalId: input.external_id,
      callerPhone: caller,
      lineId: line.id,
      greeting,
      meta: {
        did: input.did ?? null,
        line_key: input.line_key ?? null,
        raw_caller: input.caller ?? null,
        diversion: input.diversion ?? null,
        mode_reason: reason,
        pbx,
      },
    });
    this.log.log(
      `qo'ng'iroq ${callId}: klinika=${clinic.name} rejim=${mode}${reason ? ` (${reason})` : ''} ` +
        `raqam=${caller ?? input.caller ?? '?'}`,
    );

    return {
      call_id: callId,
      mode,
      clinic_name: clinic.name,
      lang: 'uz',
      greeting,
      voicemail_prompt: mode === 'voicemail' ? this.brain.voicemailPrompt(s, clinic) : null,
      voicemail_thanks: this.brain.voicemailThanks,
      voice: s.voice,
      speech_speed: s.speech_speed,
      max_seconds: s.max_call_seconds,
      record: s.record_calls || mode === 'voicemail',
      caller_known: !!caller,
      transfer_available: pbx || !!normalizeUzPhone(s.transfer_phone),
      date: localDateOf(new Date()),
    };
  }

  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 1200 } })
  @Post('turn')
  async turn(@Headers('x-voice-agent-key') key: string | undefined, @Body() body: unknown) {
    this.auth(key);
    const input = TurnSchema.parse(body);
    if (!input.text.trim()) throw new BadRequestException('Bo‘sh matn');
    return this.brain.handleTurn(input.call_id, {
      text: input.text,
      altTextRu: input.alt_text_ru ?? null,
      sttSeconds: input.stt_seconds,
    });
  }

  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 600 } })
  @Post('end')
  async end(@Headers('x-voice-agent-key') key: string | undefined, @Body() body: unknown) {
    this.auth(key);
    const input = EndSchema.parse(body);
    return this.brain.endSession(input.call_id, {
      durationSec: input.duration_sec,
      sttSeconds: input.stt_seconds,
      ttsChars: input.tts_chars,
      hangupBy: input.hangup_by,
      error: input.error ?? null,
      voicemailTranscript: input.voicemail_transcript ?? null,
      hasRecording: input.has_recording,
    });
  }

  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 300 } })
  @Post('recording')
  async recording(@Headers('x-voice-agent-key') key: string | undefined, @Body() body: unknown) {
    this.auth(key);
    const input = RecordingSchema.parse(body);
    const admin = this.supabase.admin();
    const { data: call } = await admin
      .from('ai_calls')
      .select('id, clinic_id, started_at')
      .eq('id', input.call_id)
      .maybeSingle();
    if (!call) throw new BadRequestException('Qo‘ng‘iroq topilmadi');
    const c = call as { id: string; clinic_id: string; started_at: string };
    const buf = Buffer.from(input.wav_base64, 'base64');
    if (buf.subarray(0, 4).toString('ascii') !== 'RIFF') throw new BadRequestException('WAV emas');
    const path = `${c.clinic_id}/${localDateOf(c.started_at).slice(0, 7)}/${c.id}.wav`;
    const { error } = await admin.storage
      .from('call-recordings')
      .upload(path, buf, { contentType: 'audio/wav', upsert: true });
    if (error) throw new BadRequestException(`Yozuv saqlanmadi: ${error.message}`);
    await admin.from('ai_calls').update({ recording_path: path }).eq('id', c.id);
    return { ok: true, path };
  }
}
