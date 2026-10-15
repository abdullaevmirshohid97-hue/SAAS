import { C, UA, WebSocketInterface } from 'jssip';
import type { RTCSession, RTCSessionEventMap } from 'jssip/lib/RTCSession';
import type { RTCSessionEvent } from 'jssip/lib/UA';
import type { PbxSoftphoneAccount } from '@clary/api-client';
import { toast } from 'sonner';

import { api } from '@/lib/api';

import { normalizeDial, prettyNumber } from './numbers';
import { useSoftphone } from './store';
import { startRingback, startRingtone, stopTones } from './tones';

// =============================================================================
// Clary softfoni — SIP over WebSocket + WebRTC (JsSIP)
// =============================================================================
// Akkaunt: GET /telephony/me (ichki raqamning "web" akkaunti, parol o'rniga HA1).
// Asterisk: wss://<PBX_DOMAIN>/ws → Caddy → Asterisk (infra/asterisk/http.conf).
// Bir vaqtda bitta qo'ng'iroq: band paytda kelgan qo'ng'iroq 486 Busy (guruhdagi
// boshqa telefonlar jiringlayveradi).
// =============================================================================

type Account = Extract<PbxSoftphoneAccount, { enabled: true }>;

let ua: UA | null = null;
let uaKey = '';
let session: RTCSession | null = null;
let current: Account | null = null;
let remoteAudio: HTMLAudioElement | null = null;
let notification: Notification | null = null;

const store = () => useSoftphone.getState();

// ---------------------------------------------------------------------------
// Ovoz
// ---------------------------------------------------------------------------
function audioEl(): HTMLAudioElement {
  if (!remoteAudio) {
    remoteAudio = document.createElement('audio');
    remoteAudio.autoplay = true;
    remoteAudio.setAttribute('playsinline', '');
    remoteAudio.style.display = 'none';
    document.body.appendChild(remoteAudio);
  }
  return remoteAudio;
}

function playStream(stream: MediaStream) {
  const el = audioEl();
  if (el.srcObject !== stream) el.srcObject = stream;
  void el.play().catch(() => undefined);
}

function attachExisting(s: RTCSession) {
  try {
    const tracks = (s.connection?.getReceivers?.() ?? [])
      .map((r) => r.track)
      .filter((t): t is MediaStreamTrack => !!t && t.kind === 'audio');
    if (tracks.length) playStream(new MediaStream(tracks));
  } catch {
    /* ulanish yopilgan */
  }
}

// ---------------------------------------------------------------------------
// Yordamchilar
// ---------------------------------------------------------------------------

const CAUSES: Record<string, string> = {
  Bye: 'Tugadi',
  Canceled: 'Bekor qilindi',
  Busy: 'Band',
  Rejected: 'Rad etildi',
  'No Answer': 'Javob bermadi',
  Unavailable: 'Mavjud emas',
  'Not Found': 'Raqam topilmadi',
  'Address Incomplete': 'Raqam to‘liq emas',
  'User Denied Media Access': 'Mikrofonga ruxsat berilmagan',
  'Connection Error': 'Server bilan aloqa uzildi',
  'Request Timeout': 'Javob kelmadi',
  'RTP Timeout': 'Ovoz uzildi',
  'Authentication Error': 'Avtorizatsiya xatosi',
  'WebRTC Error': 'Brauzer ovoz xatosi',
};

function humanCause(cause: string | undefined | null): string {
  return (cause && CAUSES[cause]) || cause || 'Tugadi';
}

function notifyIncoming(number: string, name: string | null) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!document.hidden) return;
  try {
    notification = new Notification('Kiruvchi qo‘ng‘iroq', {
      body: name ? `${name} · ${prettyNumber(number)}` : prettyNumber(number),
      tag: 'clary-call',
      requireInteraction: true,
    });
    notification.onclick = () => {
      window.focus();
      notification?.close();
    };
  } catch {
    notification = null;
  }
}

function lookup(callId: string, number: string) {
  if (number.replace(/\D/g, '').length < 7) return;
  api.telephony
    .lookup(number)
    .then((r) => {
      const c = store().call;
      if (c && c.id === callId) {
        store().patchCall({
          lookup: r,
          name: c.name ?? r.patients[0]?.full_name ?? null,
        });
      }
    })
    .catch(() => undefined);
}

/** ICE: TURN bo'lsa relay, bo'lmasa srflx nomzod kelishi bilan (yoki 2 s) INVITE yuboriladi. */
function iceHandler(acc: Account): RTCSessionEventMap['icecandidate'] {
  const hasTurn = acc.ice_servers.some((s) => s.urls.some((u) => u.startsWith('turn')));
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (e) => {
    const type = e.candidate.type;
    if ((hasTurn && type === 'relay') || (!hasTurn && type === 'srflx')) {
      if (timer) clearTimeout(timer);
      e.ready();
      return;
    }
    timer ??= setTimeout(() => e.ready(), 2000);
  };
}

// ---------------------------------------------------------------------------
// Qo'ng'iroq hodisalari
// ---------------------------------------------------------------------------
function finish(s: RTCSession, cause: string | null | undefined) {
  if (session && session !== s) return;
  stopTones();
  notification?.close();
  notification = null;
  session = null;
  if (remoteAudio) remoteAudio.srcObject = null;
  const c = store().call;
  if (!c || c.id !== s.id) return;
  // Kiruvchi va boshqa joyda olingan / bemor go'shakni qo'ygan — darhol yopiladi
  const quiet = c.direction === 'in' && c.phase === 'ringing';
  store().patchCall({ phase: 'ended', cause: humanCause(cause) });
  setTimeout(
    () => {
      if (store().call?.id === s.id) store().setCall(null);
    },
    quiet ? 300 : 2500,
  );
}

/** ref.s — shu qo'ng'iroq sessiyasi (chiquvchida ua.call() qaytgach to'ldiriladi). */
function handlers(
  acc: Account,
  direction: 'in' | 'out',
  ref: { s: RTCSession | null },
): Partial<RTCSessionEventMap> {
  const get = () => ref.s;
  const end = (cause: string | undefined) => {
    const s = get();
    if (s) finish(s, cause);
    // ua.call() ichida (sinxron) tugagan bo'lsa — sessiya hali biriktirilmagan
    else queueMicrotask(() => ref.s && finish(ref.s, cause));
  };
  return {
    peerconnection: ({ peerconnection }) => {
      peerconnection.addEventListener('track', (ev) => {
        playStream(ev.streams[0] ?? new MediaStream([ev.track]));
      });
    },
    icecandidate: iceHandler(acc),
    progress: (e: unknown) => {
      if (direction !== 'out') return;
      const code = (e as { response?: { status_code?: number } }).response?.status_code;
      // 183 — operator o'z gudokini yuboradi (erta media); 180 — o'zimiz chalamiz
      if (code === 183) stopTones();
      else startRingback();
    },
    accepted: () => {
      stopTones();
      store().patchCall({ phase: 'active', answeredAt: Date.now() });
      const s = get();
      if (s) attachExisting(s);
    },
    confirmed: () => {
      const s = get();
      if (s) attachExisting(s);
    },
    ended: (e) => end(e.cause),
    failed: (e) => {
      end(e.cause);
      if (e.cause === 'User Denied Media Access') {
        toast.error('Mikrofonga ruxsat bering (brauzer manzil satridagi 🔒 belgisi)');
      }
    },
    hold: (e) => {
      if (String(e.originator) === 'local') store().patchCall({ held: true });
    },
    unhold: (e) => {
      if (String(e.originator) === 'local') store().patchCall({ held: false });
    },
    muted: () => store().patchCall({ muted: true }),
    unmuted: () => store().patchCall({ muted: false }),
  };
}

function onNewSession(e: RTCSessionEvent) {
  if (String(e.originator) !== 'remote') return; // chiquvchi — dial() o'zi boshqaradi
  const s = e.session;
  const acc = current;
  if (!acc || session) {
    s.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
    return;
  }
  session = s;
  const h = handlers(acc, 'in', { s });
  for (const k of Object.keys(h) as Array<keyof RTCSessionEventMap>) {
    s.on(k, h[k] as never);
  }
  const number = s.remote_identity?.uri?.user ?? '';
  const name = s.remote_identity?.display_name?.trim() || null;
  store().setCall({
    id: s.id,
    direction: 'in',
    number,
    name: name && name !== number ? name : null,
    phase: 'ringing',
    startedAt: Date.now(),
    answeredAt: null,
    muted: false,
    held: false,
    cause: null,
    lookup: null,
  });
  startRingtone();
  notifyIncoming(number, name);
  lookup(s.id, number);
}

// ---------------------------------------------------------------------------
// Ommaviy API
// ---------------------------------------------------------------------------

/** Softfonni ishga tushiradi (akkaunt o'zgarmagan bo'lsa — faqat ICE ro'yxatini yangilaydi). */
export function startSoftphone(acc: Account) {
  current = acc;
  const key = `${acc.ws_url}|${acc.uri}|${acc.ha1}|${acc.realm}`;
  if (ua && key === uaKey) return;
  stopSoftphone();
  current = acc;
  uaKey = key;
  const st = store();
  st.setReg('connecting');
  try {
    const socket = new WebSocketInterface(acc.ws_url);
    const agent = new UA({
      sockets: [socket],
      uri: acc.uri,
      authorization_user: acc.username,
      ha1: acc.ha1,
      realm: acc.realm,
      display_name: acc.display_name,
      register: true,
      register_expires: 300,
      session_timers: false,
      user_agent: 'Clary Softphone',
      connection_recovery_min_interval: 2,
      connection_recovery_max_interval: 30,
    });
    agent.on('connecting', () => {
      if (ua === agent && store().reg !== 'registered') store().setReg('connecting');
    });
    agent.on('registered', () => {
      if (ua === agent) store().setReg('registered');
    });
    agent.on('unregistered', () => {
      if (ua === agent) store().setReg('connecting');
    });
    agent.on('registrationFailed', (e) => {
      if (ua === agent) store().setReg('failed', e.cause ? humanCause(String(e.cause)) : null);
    });
    agent.on('disconnected', () => {
      if (ua === agent) store().setReg('connecting', 'Server bilan aloqa yo‘q — qayta ulanmoqda');
    });
    agent.on('newRTCSession', onNewSession);
    ua = agent;
    agent.start();
  } catch (e) {
    ua = null;
    uaKey = '';
    st.setReg('failed', (e as Error).message);
  }
}

export function stopSoftphone() {
  try {
    session?.terminate();
  } catch {
    /* allaqachon tugagan */
  }
  session = null;
  stopTones();
  const agent = ua;
  ua = null;
  uaKey = '';
  try {
    agent?.stop();
  } catch {
    /* ulanish yo'q */
  }
  store().setReg('off');
  if (store().call) store().setCall(null);
}

export function isInCall(): boolean {
  return !!session;
}

/** Raqam terish. Muvaffaqiyatli boshlansa true. */
export function dial(raw: string, name: string | null = null): boolean {
  const acc = current;
  if (!ua || !acc || store().reg !== 'registered') {
    toast.error('Telefon ulanmagan — yuqoridagi 📞 belgisini tekshiring');
    return false;
  }
  if (session) {
    toast.error('Avval joriy qo‘ng‘iroqni tugating');
    return false;
  }
  const num = normalizeDial(raw);
  if (!num) {
    toast.error('Raqam noto‘g‘ri (O‘zbekiston raqami yoki ichki raqam)');
    return false;
  }
  try {
    const ref: { s: RTCSession | null } = { s: null };
    const s = ua.call(`sip:${num}@${acc.sip_domain}`, {
      mediaConstraints: { audio: true, video: false },
      pcConfig: { iceServers: acc.ice_servers },
      rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
      eventHandlers: handlers(acc, 'out', ref),
    });
    ref.s = s;
    session = s;
    store().setCall({
      id: s.id,
      direction: 'out',
      number: num,
      name,
      phase: 'calling',
      startedAt: Date.now(),
      answeredAt: null,
      muted: false,
      held: false,
      cause: null,
      lookup: null,
    });
    if (!name && num.length > 3) lookup(s.id, num);
    return true;
  } catch (e) {
    session = null;
    toast.error(`Qo‘ng‘iroq boshlanmadi: ${(e as Error).message}`);
    return false;
  }
}

/** Ilovaning istalgan joyidan (bemor kartasi, qo'ng'iroqlar jurnali): panelni ochib teradi. */
export function dialFromApp(phone: string, name: string | null = null): boolean {
  store().setDraft(phone);
  store().setPanelOpen(true);
  return dial(phone, name);
}

export function answer() {
  const s = session;
  const acc = current;
  if (!s || !acc) return;
  stopTones();
  notification?.close();
  try {
    s.answer({
      mediaConstraints: { audio: true, video: false },
      pcConfig: { iceServers: acc.ice_servers },
    });
  } catch (e) {
    toast.error(`Javob berib bo‘lmadi: ${(e as Error).message}`);
  }
}

export function hangup() {
  const s = session;
  if (!s) {
    if (store().call) store().setCall(null);
    return;
  }
  try {
    s.terminate();
  } catch {
    finish(s, 'Bye');
  }
}

export function toggleMute() {
  const s = session;
  if (!s?.isEstablished()) return;
  if (s.isMuted().audio) s.unmute({ audio: true });
  else s.mute({ audio: true });
}

export function toggleHold() {
  const s = session;
  if (!s?.isEstablished()) return;
  if (s.isOnHold().local) s.unhold();
  else s.hold();
}

export function sendDtmf(tone: string) {
  const s = session;
  if (!s?.isEstablished() || !/^[0-9*#]$/.test(tone)) return;
  try {
    s.sendDTMF(tone, { transportType: C.DTMF_TRANSPORT.RFC2833 });
  } catch {
    /* DTMF yuborilmadi */
  }
}

/** Ko'r-ko'rona ulash (blind transfer) ichki raqamga yoki raqamga. */
export function transfer(target: string) {
  const s = session;
  const acc = current;
  if (!s?.isEstablished() || !acc) return;
  const num = normalizeDial(target);
  if (!num) {
    toast.error('Ulash raqami noto‘g‘ri');
    return;
  }
  try {
    s.refer(`sip:${num}@${acc.sip_domain}`, {
      eventHandlers: {
        accepted: () => toast.success(`${num} ga ulandi`),
        failed: () => toast.error('Ulab bo‘lmadi'),
      },
    });
  } catch (e) {
    toast.error(`Ulab bo‘lmadi: ${(e as Error).message}`);
  }
}

/** Brauzer bildirishnomasi (sahifa yashirin bo'lsa kiruvchi qo'ng'iroq haqida). */
export function requestNotificationPermission() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
  void Notification.requestPermission().catch(() => undefined);
}

// Sahifa yopilayotganda qo'ng'iroq bo'lsa — ogohlantirish
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (session) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}
