import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// =============================================================================
// voice-agent sozlamalari — .env (paket ildizida) yoki muhit o'zgaruvchilari
// =============================================================================

/** Kichik .env o'quvchi (qo'shimcha paketsiz). Mavjud env ustidan YOZMAYDI. */
export function loadDotEnv(file = resolve(__dirname, '../../.env')): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const key = m[1] as string;
    let val = (m[2] ?? '').trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function num(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== '' ? v : def;
}

function bool(name: string, def: boolean): boolean {
  const v = (process.env[name] ?? '').trim().toLowerCase();
  if (!v) return def;
  return v === '1' || v === 'true' || v === 'yes';
}

function str(name: string, def = ''): string {
  return (process.env[name] ?? def).trim();
}

export type SttProviderName = 'aisha' | 'openai' | 'none';
export type TtsProviderName = 'aisha' | 'http';
export type TransferFormat = 'e164' | 'digits12' | 'local9';

export interface Config {
  apiUrl: string;
  secret: string;
  audiosocketHost: string;
  audiosocketPort: number;
  controlHost: string;
  controlPort: number;

  sttProvider: SttProviderName;
  sttDualFirst: boolean;
  aishaKey: string;
  aishaBase: string;
  sttOpenaiUrl: string;
  sttOpenaiKey: string;
  sttOpenaiModel: string;

  ttsProvider: TtsProviderName;
  ttsHttpUrl: string;
  ttsDefaultVoice: string;
  ttsCacheDir: string;

  vadStartDb: number;
  vadEndSilenceMs: number;
  vadMinSpeechMs: number;
  vadMaxUtteranceMs: number;
  noInputMs: number;
  fillerAfterMs: number;
  voicemailMaxMs: number;

  transferFormat: TransferFormat;
  transferEndpoint: string;
  recordingsDir: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';

  /** Bulutli ATS: Asterisk sozlamasini Clary API'dan generatsiya qilish */
  pbxEnabled: boolean;
  pbxConfDir: string;
  pbxSyncSec: number;
  pbxStatusSec: number;
  pbxRecordingsDir: string;
  pbxKeepRecordings: boolean;
  pbxTimezone: string;
  asteriskBin: string;
}

export function loadConfig(): Config {
  loadDotEnv();
  const aishaKey = str('AISHA_API_KEY');
  const sttOpenaiUrl = str('STT_OPENAI_URL');
  const sttRaw = str('STT_PROVIDER').toLowerCase();
  const sttProvider: SttProviderName =
    sttRaw === 'aisha' || sttRaw === 'openai' || sttRaw === 'none'
      ? sttRaw
      : aishaKey
        ? 'aisha'
        : sttOpenaiUrl
          ? 'openai'
          : 'none';
  const ttsRaw = str('TTS_PROVIDER').toLowerCase();
  const ttsProvider: TtsProviderName = ttsRaw === 'http' ? 'http' : 'aisha';
  const tf = str('TRANSFER_NUMBER_FORMAT', 'e164') as TransferFormat;

  return {
    apiUrl: str('VOICE_API_URL', 'https://api.clary.uz').replace(/\/$/, ''),
    secret: str('VOICE_AGENT_SECRET'),
    audiosocketHost: str('AUDIOSOCKET_HOST', '127.0.0.1'),
    audiosocketPort: num('AUDIOSOCKET_PORT', 9092),
    controlHost: str('CONTROL_HOST', '127.0.0.1'),
    controlPort: num('CONTROL_PORT', 7071),

    sttProvider,
    sttDualFirst: bool('STT_DUAL_FIRST', true),
    aishaKey,
    aishaBase: str('AISHA_BASE_URL', 'https://back.aisha.group').replace(/\/$/, ''),
    sttOpenaiUrl: sttOpenaiUrl.replace(/\/$/, ''),
    sttOpenaiKey: str('STT_OPENAI_KEY'),
    sttOpenaiModel: str('STT_OPENAI_MODEL', 'whisper-1'),

    ttsProvider,
    ttsHttpUrl: str('TTS_HTTP_URL'),
    ttsDefaultVoice: str('TTS_DEFAULT_VOICE', 'Gulnoza'),
    ttsCacheDir: resolve(str('TTS_CACHE_DIR', resolve(__dirname, '../../var/tts-cache'))),

    vadStartDb: num('VAD_START_DB', 12),
    vadEndSilenceMs: num('VAD_END_SILENCE_MS', 700),
    vadMinSpeechMs: num('VAD_MIN_SPEECH_MS', 250),
    vadMaxUtteranceMs: num('VAD_MAX_UTTERANCE_MS', 15_000),
    noInputMs: num('NO_INPUT_MS', 7000),
    fillerAfterMs: num('FILLER_AFTER_MS', 1300),
    voicemailMaxMs: num('VOICEMAIL_MAX_MS', 60_000),

    transferFormat: ['e164', 'digits12', 'local9'].includes(tf) ? tf : 'e164',
    transferEndpoint: str('TRANSFER_ENDPOINT'),
    recordingsDir: str('RECORDINGS_DIR'),
    logLevel: (str('LOG_LEVEL', 'info') as Config['logLevel']) || 'info',

    pbxEnabled: bool('PBX_ENABLED', false),
    pbxConfDir: str('PBX_CONF_DIR', '/etc/asterisk'),
    pbxSyncSec: Math.max(num('PBX_SYNC_SEC', 30), 10),
    pbxStatusSec: Math.max(num('PBX_STATUS_SEC', 30), 10),
    pbxRecordingsDir: str('PBX_RECORDINGS_DIR', '/var/spool/asterisk/monitor/clary'),
    pbxKeepRecordings: bool('PBX_KEEP_RECORDINGS', false),
    pbxTimezone: str('PBX_TIMEZONE', 'Asia/Tashkent'),
    asteriskBin: str('ASTERISK_BIN', 'asterisk'),
  };
}

/** AI suhbat (STT/TTS) uchun yetishmayotgan sozlamalar. */
export function aiConfigProblems(c: Config): string[] {
  const errors: string[] = [];
  if (c.sttProvider === 'none') errors.push('STT sozlanmagan: AISHA_API_KEY yoki STT_OPENAI_URL');
  if (c.sttProvider === 'aisha' && !c.aishaKey)
    errors.push('STT_PROVIDER=aisha, lekin AISHA_API_KEY yo‘q');
  if (c.sttProvider === 'openai' && !c.sttOpenaiUrl)
    errors.push('STT_PROVIDER=openai, lekin STT_OPENAI_URL yo‘q');
  if (c.ttsProvider === 'aisha' && !c.aishaKey)
    errors.push('TTS_PROVIDER=aisha, lekin AISHA_API_KEY yo‘q');
  if (c.ttsProvider === 'http' && !c.ttsHttpUrl)
    errors.push('TTS_PROVIDER=http, lekin TTS_HTTP_URL yo‘q');
  return errors;
}

/**
 * Ishga tushishdan oldin tekshiruv — xato bo'lsa aniq sabab. Bulutli ATS yoqilgan
 * bo'lsa STT/TTS yo'qligi to'xtatmaydi (ATS AI'siz ham ishlaydi — hech kim olmasa
 * AI o'rniga "keyinroq qo'ng'iroq qiling").
 */
export function validateConfig(c: Config): string[] {
  const errors: string[] = [];
  if (c.secret.length < 24)
    errors.push('VOICE_AGENT_SECRET kamida 24 belgi bo‘lsin (API bilan bir xil)');
  if (!c.pbxEnabled) errors.push(...aiConfigProblems(c));
  if (c.pbxEnabled && !/^\/[A-Za-z0-9._/-]+$/.test(c.pbxRecordingsDir))
    errors.push(
      'PBX_RECORDINGS_DIR mutlaq yo‘l bo‘lsin (masalan /var/spool/asterisk/monitor/clary)',
    );
  return errors;
}

/** Odamga ulash raqamini operator/shlyuz kutgan ko'rinishga keltiradi. */
export function formatTransferNumber(e164: string, format: TransferFormat): string {
  const d = e164.replace(/\D/g, '');
  if (format === 'local9') return d.slice(-9);
  if (format === 'digits12') return d.length === 9 ? `998${d}` : d;
  return d.length === 9 ? `+998${d}` : `+${d}`;
}
