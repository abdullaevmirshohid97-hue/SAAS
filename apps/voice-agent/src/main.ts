import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createServer as createTcpServer } from 'node:net';

import { encodeFrame, FrameParser } from './audiosocket';
import { CallSession, staticPhrases } from './call-session';
import { ClaryApi } from './clary-api';
import { loadConfig, validateConfig } from './config';
import { logger, setLogLevel } from './log';
import { createStt } from './providers/stt';
import { TtsEngine } from './providers/tts';
import { CallRegistry } from './registry';

// =============================================================================
// Clary voice-agent — Asterisk yonida ishlaydi (pm2: clary-voice)
// =============================================================================
//   TCP  AUDIOSOCKET_PORT (9092) — Asterisk AudioSocket() ulanishlari
//   HTTP CONTROL_PORT (7071)     — faqat 127.0.0.1: dialplan CURL uchun
//        GET /calls/register?uuid&line&did&from&diversion → "OK"
//        GET /calls/next?uuid                               → "hangup" | "transfer:..." | "fallback"
//        GET /health                                        → JSON holat
// Batafsil: docs/ai-reception/02-server-asterisk.md
// =============================================================================

const cfg = loadConfig();
setLogLevel(cfg.logLevel);
const log = logger('main');

const problems = validateConfig(cfg);
if (problems.length) {
  for (const p of problems) log.error(`sozlama: ${p}`);
  log.error('.env ni to‘ldiring (namuna: apps/voice-agent/.env.example). To‘xtatildi.');
  process.exit(1);
}

const api = new ClaryApi(cfg.apiUrl, cfg.secret);
const stt = createStt(cfg);
const tts = new TtsEngine(cfg);
const registry = new CallRegistry();
let apiOk: { ok: boolean; at: number; error?: string } = { ok: false, at: 0 };

// ---------------------------------------------------------------------------
// AudioSocket
// ---------------------------------------------------------------------------
const tcp = createTcpServer((socket) => {
  socket.setNoDelay(true);
  const parser = new FrameParser();
  const session = new CallSession({
    cfg,
    api,
    stt,
    tts,
    registry,
    send: (kind, payload) => {
      if (!socket.destroyed) socket.write(encodeFrame(kind, payload));
    },
    close: () => socket.end(),
  });
  socket.on('data', (chunk) => {
    for (const f of parser.push(chunk)) session.onFrame(f);
  });
  socket.on('close', () => session.onSocketClosed());
  socket.on('error', (e) => log.warn(`socket: ${e.message}`));
});
tcp.listen(cfg.audiosocketPort, cfg.audiosocketHost, () =>
  log.info(`AudioSocket: ${cfg.audiosocketHost}:${cfg.audiosocketPort}`),
);

// ---------------------------------------------------------------------------
// Boshqaruv HTTP (faqat localhost — dialplan CURL)
// ---------------------------------------------------------------------------
function reply(res: ServerResponse, code: number, body: string, type = 'text/plain') {
  res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8` });
  res.end(body);
}

const http = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const q = (k: string) => {
    const v = url.searchParams.get(k);
    return v && v.trim() ? v.trim() : null;
  };
  if (url.pathname === '/calls/register') {
    const uuid = q('uuid');
    if (!uuid || !/^[0-9a-f-]{36}$/i.test(uuid)) return reply(res, 400, 'BAD_UUID');
    registry.register({
      uuid,
      line: q('line'),
      did: q('did'),
      from: q('from'),
      diversion: q('diversion'),
    });
    return reply(res, 200, 'OK');
  }
  if (url.pathname === '/calls/next') {
    const uuid = q('uuid');
    return reply(res, 200, uuid ? registry.takeNext(uuid) : 'hangup');
  }
  if (url.pathname === '/health') {
    return reply(
      res,
      200,
      JSON.stringify({
        ok: apiOk.ok,
        api: apiOk,
        active_calls: registry.activeCalls,
        stt: stt?.name ?? null,
        tts: tts.name,
        uptime_sec: Math.round(process.uptime()),
      }),
      'application/json',
    );
  }
  return reply(res, 404, 'NOT_FOUND');
});
http.listen(cfg.controlPort, cfg.controlHost, () =>
  log.info(`Boshqaruv HTTP: http://${cfg.controlHost}:${cfg.controlPort}`),
);

// ---------------------------------------------------------------------------
// API holati + iboralarni oldindan sintez (birinchi qo'ng'iroq kechikmasin)
// ---------------------------------------------------------------------------
async function checkApi() {
  try {
    const r = await api.ping();
    apiOk = { ok: r.ok, at: Date.now() };
  } catch (e) {
    apiOk = { ok: false, at: Date.now(), error: (e as Error).message };
    log.warn(`API javob bermadi: ${(e as Error).message}`);
  }
}
void checkApi();
setInterval(() => void checkApi(), 60_000);

void (async () => {
  let n = 0;
  for (const p of staticPhrases()) {
    try {
      await tts.synthesize(p.text, p.lang);
      n++;
    } catch (e) {
      log.warn(`oldindan sintez: ${(e as Error).message}`);
      break;
    }
  }
  log.info(`TTS keshi tayyor (${n} ta ibora, provayder: ${tts.name}); STT: ${stt?.name ?? 'YO‘Q'}`);
})();

function shutdown(sig: string) {
  log.info(`${sig} — to'xtatilmoqda (faol qo'ng'iroqlar: ${registry.activeCalls})`);
  tcp.close();
  http.close();
  setTimeout(() => process.exit(0), registry.activeCalls ? 5000 : 200);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
