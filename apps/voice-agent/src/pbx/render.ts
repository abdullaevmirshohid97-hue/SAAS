import type { PbxAgentConfig, PbxDialFormat, PbxExtensionConf, PbxTenantConf } from './types';

// =============================================================================
// Bulutli ATS — Asterisk sozlamasini generatsiya qilish (sof funksiyalar, testlanadi)
// =============================================================================
//   pjsip_clary.conf      — har klinika: Uztelecom trunk (registration line=yes),
//                           ichki raqamlar (stol telefoni + Clary softfoni/WebRTC)
//   extensions_clary.conf — har klinika: kiruvchi (guruh → AI), ichki, chiquvchi
// Umumiy qismlar (shablonlar, clary-pbx-append, clary-pbx-hangup, clary-ai) —
// infra/asterisk/{pjsip,extensions}.conf da (statik).
//
// XAVFSIZLIK: qiymatlar klinika kiritgan ma'lumotdan keladi — har biri qat'iy
// tekshiriladi, mos kelmasa o'sha qism tashlab yuboriladi (fayl in'ektsiyasi yo'q).
// =============================================================================

export interface RenderOptions {
  /** GotoIfTime uchun: Asia/Tashkent */
  timezone: string;
  /** MixMonitor yozuvlari: /var/spool/asterisk/monitor/clary */
  recordingsDir: string;
  /** voice-agent'da STT/TTS sozlanmagan bo'lsa — hech kim olmasa AI'ga emas */
  aiAvailable: boolean;
}

const CODE_RE = /^[a-z][a-z0-9]{2,15}$/;
const EXT_RE = /^[2-8][0-9]{2}$/;
const ENDPOINT_RE = /^[a-z][a-z0-9]{2,24}$/;
const HA1_RE = /^[0-9a-f]{32}$/;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9-]+\.)*[a-z0-9-]+$/i;
const SIP_USER_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const DID_RE = /^\+998\d{9}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TZ_RE = /^[A-Za-z]+(\/[A-Za-z0-9_+-]+)*$/;
const PATH_RE = /^\/[A-Za-z0-9._/-]+$/;
const REALM_RE = /^[a-z0-9.-]{1,40}$/;

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// ---------------------------------------------------------------------------
// Ekranlash
// ---------------------------------------------------------------------------

/** Asterisk .conf qiymati: boshqaruv belgilari olib tashlanadi, ';' (izoh) ekranlanadi. */
export function confValue(v: string): string {
  return String(v)
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/;/g, '\\;')
    .trim();
}

/** Izoh qatori — yangi qator in'ektsiyasi bo'lmasin. */
export function commentText(v: string): string {
  return String(v)
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** callerid="..." ichidagi ism. */
export function callerName(v: string): string {
  const s = String(v)
    .replace(/["<>;\\\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  return s || 'Clary';
}

// ---------------------------------------------------------------------------
// Vaqt
// ---------------------------------------------------------------------------

function minutes(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? ''));
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (mi > 59 || h > 24 || (h === 24 && mi > 0)) return null;
  return h * 60 + mi;
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/**
 * Ish vaqti → GotoIfTime oraliqlari. GotoIfTime oxirgi daqiqani ham qamraydi,
 * shuning uchun 09:00–18:00 → "09:00-17:59". Tungi smena ikkiga bo'linadi.
 */
export function timeRanges(
  hours: PbxTenantConf['hours'],
): Array<{ times: string; weekday: (typeof WEEKDAYS)[number] }> {
  const out: Array<{ times: string; weekday: (typeof WEEKDAYS)[number] }> = [];
  const sorted = [...(hours ?? [])].sort(
    (a, b) => a.weekday - b.weekday || String(a.start).localeCompare(String(b.start)),
  );
  for (const h of sorted) {
    if (!Number.isInteger(h.weekday) || h.weekday < 0 || h.weekday > 6) continue;
    const s = minutes(h.start);
    const e = minutes(h.end);
    if (s === null || e === null) continue;
    const wd = WEEKDAYS[h.weekday]!;
    if (s === e || (s === 0 && e === 1440)) {
      out.push({ times: '00:00-23:59', weekday: wd });
    } else if (e > s) {
      out.push({ times: `${hhmm(s)}-${hhmm(e - 1)}`, weekday: wd });
    } else {
      out.push({ times: `${hhmm(s)}-23:59`, weekday: wd });
      if (e > 0)
        out.push({ times: `00:00-${hhmm(e - 1)}`, weekday: WEEKDAYS[(h.weekday + 1) % 7]! });
    }
  }
  return out;
}

/** Bayram sanalari → GotoIfTime kun/oy ("15", "oct"). */
export function closedDays(dates: string[]): Array<{ mday: string; month: string }> {
  const seen = new Set<string>();
  const out: Array<{ mday: string; month: string }> = [];
  for (const d of dates ?? []) {
    const m = DATE_RE.exec(d);
    if (!m) continue;
    const month = MONTHS[Number(m[2]) - 1];
    const mday = String(Number(m[3]));
    if (!month || Number(mday) < 1 || Number(mday) > 31) continue;
    const key = `${mday}-${month}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ mday, month });
  }
  return out;
}

/** Chiquvchi raqam (EXTEN = 998XXXXXXXXX) operator kutgan ko'rinishda. */
export function dialNumberExpr(format: PbxDialFormat): string {
  if (format === 'e164') return '+${EXTEN}';
  if (format === 'local9') return '${EXTEN:3}';
  return '${EXTEN}';
}

// ---------------------------------------------------------------------------
// Tekshiruv
// ---------------------------------------------------------------------------

interface CleanTenant extends PbxTenantConf {
  extensions: PbxExtensionConf[];
  skipped: string[];
}

function cleanTenants(cfg: PbxAgentConfig): CleanTenant[] {
  const out: CleanTenant[] = [];
  const codes = new Set<string>();
  const users = new Set<string>();
  for (const t of cfg.tenants ?? []) {
    if (!CODE_RE.test(t.code) || codes.has(t.code)) continue;
    codes.add(t.code);
    const skipped: string[] = [];
    let trunk = t.trunk;
    if (trunk) {
      const ok =
        HOST_RE.test(trunk.host) &&
        SIP_USER_RE.test(trunk.username) &&
        typeof trunk.password === 'string' &&
        trunk.password.length > 0 &&
        Number.isInteger(trunk.port) &&
        trunk.port >= 1 &&
        trunk.port <= 65535 &&
        (trunk.transport === 'udp' || trunk.transport === 'tcp');
      if (!ok) {
        skipped.push('trunk (server/login/parol noto‘g‘ri)');
        trunk = null;
      } else {
        trunk = {
          ...trunk,
          from_domain: HOST_RE.test(trunk.from_domain) ? trunk.from_domain : trunk.host,
          did: trunk.did && DID_RE.test(trunk.did) ? trunk.did : null,
          dial_format: ['e164', 'digits12', 'local9'].includes(trunk.dial_format)
            ? trunk.dial_format
            : 'digits12',
        };
      }
    }
    const extensions: PbxExtensionConf[] = [];
    const exts = new Set<string>();
    for (const e of t.extensions ?? []) {
      const ok =
        EXT_RE.test(e.ext) &&
        !exts.has(e.ext) &&
        ENDPOINT_RE.test(e.phone_user) &&
        ENDPOINT_RE.test(e.web_user) &&
        e.phone_user !== e.web_user &&
        !users.has(e.phone_user) &&
        !users.has(e.web_user) &&
        HA1_RE.test(e.phone_ha1) &&
        HA1_RE.test(e.web_ha1);
      if (!ok) {
        skipped.push(`ichki raqam ${commentText(String(e.ext))}`);
        continue;
      }
      exts.add(e.ext);
      users.add(e.phone_user);
      users.add(e.web_user);
      extensions.push(e);
    }
    out.push({
      ...t,
      trunk,
      ring_timeout: Math.min(Math.max(Math.round(Number(t.ring_timeout) || 20), 5), 120),
      max_outbound: Math.min(Math.max(Math.round(Number(t.max_outbound) || 4), 1), 50),
      extensions,
      skipped,
    });
  }
  return out;
}

/** Sarlavha vaqt belgisisiz — natija o'zgarmasa fayl ham o'zgarmaydi (keraksiz reload yo'q). */
function header(n: number): string[] {
  return [
    '; =============================================================================',
    "; AVTOMATIK YARATILGAN — QO'LDA TAHRIRLAMANG (voice-agent, Clary API'dan)",
    `; Klinikalar: ${n}. Manba: apps/voice-agent/src/pbx/render.ts`,
    '; =============================================================================',
  ];
}

// ---------------------------------------------------------------------------
// pjsip_clary.conf
// ---------------------------------------------------------------------------

export function renderPjsip(cfg: PbxAgentConfig, _opts: RenderOptions): string {
  const realm = REALM_RE.test(cfg.realm) ? cfg.realm : 'clary';
  const tenants = cleanTenants(cfg);
  const L = header(tenants.length);
  const providers = new Map<string, number>();

  for (const t of tenants) {
    L.push('', `; ----- ${t.code} — ${commentText(t.name)} -----`);
    for (const s of t.skipped) L.push(`; O'TKAZIB YUBORILDI: ${s}`);

    const tr = t.trunk;
    if (tr) {
      const transport = tr.transport === 'tcp' ? 'transport-tcp' : 'transport-udp';
      const uriParam = tr.transport === 'tcp' ? ';transport=tcp' : '';
      const server = `sip:${tr.host}:${tr.port}${uriParam}`;
      const name = `trunk-${t.code}`;
      L.push(
        `[${name}-auth]`,
        'type=auth',
        'auth_type=userpass',
        `username=${tr.username}`,
        `password=${confValue(tr.password)}`,
        '',
        `[${name}]`,
        'type=registration',
        `transport=${transport}`,
        `outbound_auth=${name}-auth`,
        `server_uri=${server}`,
        `client_uri=sip:${tr.username}@${tr.from_domain}`,
        `contact_user=${tr.username}`,
        'retry_interval=60',
        'forbidden_retry_interval=300',
        'fatal_retry_interval=300',
        'auth_rejection_permanent=no',
        'max_retries=1000000',
        'expiration=300',
        // Bir operatorga ko'p klinika ro'yxatdan o'tadi — kiruvchi INVITE ;line= bo'yicha ajratiladi
        'line=yes',
        `endpoint=${name}`,
        '',
        `[${name}]`,
        'type=aor',
        `contact=${server}`,
        'qualify_frequency=60',
        '',
        `[${name}](clary-trunk)`,
        `transport=${transport}`,
        `outbound_auth=${name}-auth`,
        `aors=${name}`,
        `from_user=${tr.username}`,
        `from_domain=${tr.from_domain}`,
        `context=t-${t.code}-trunk`,
      );
      const host = tr.host.toLowerCase();
      if (!providers.has(host)) providers.set(host, providers.size + 1);
    }

    for (const e of t.extensions) {
      const cid = `"${callerName(e.label)}" <${e.ext}>`;
      const accounts: Array<[string, string, string, number, number]> = [
        [e.phone_user, e.phone_ha1, 'clary-ext-phone', 2, 45],
        [e.web_user, e.web_ha1, 'clary-ext-webrtc', 3, 30],
      ];
      for (const [user, ha1, template, maxContacts, qualify] of accounts) {
        L.push(
          '',
          `[${user}-auth]`,
          'type=auth',
          'auth_type=md5',
          `username=${user}`,
          `realm=${realm}`,
          `md5_cred=${ha1}`,
          '',
          `[${user}]`,
          'type=aor',
          `max_contacts=${maxContacts}`,
          'remove_existing=yes',
          `qualify_frequency=${qualify}`,
          '',
          `[${user}](${template})`,
          `auth=${user}-auth`,
          `aors=${user}`,
          `callerid=${cid}`,
          `context=t-${t.code}-ext`,
          `set_var=CLARY_TENANT=${t.code}`,
          `set_var=CLARY_EXT=${e.ext}`,
          `set_var=CLARY_CAN_OUT=${e.can_call_out ? 1 : 0}`,
        );
      }
    }
  }

  if (providers.size) {
    L.push(
      '',
      "; ----- Operator serverlari: ;line= parametrisiz kelgan qo'ng'iroqlar -----",
      "; (raqam/login bo'yicha klinika — extensions_clary.conf [clary-pbx-provider])",
    );
    for (const [host, i] of providers) {
      L.push(
        '',
        `[clary-prov-${i}](clary-trunk)`,
        'context=clary-pbx-provider',
        '',
        `[clary-prov-${i}]`,
        'type=identify',
        `endpoint=clary-prov-${i}`,
        `match=${host}`,
      );
    }
  }
  return `${L.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// extensions_clary.conf
// ---------------------------------------------------------------------------

const UUID_EXPR = "${SHELL(cat /proc/sys/kernel/random/uuid | tr -d '\\n')}";

export function renderDialplan(cfg: PbxAgentConfig, opts: RenderOptions): string {
  const tz = TZ_RE.test(opts.timezone) ? opts.timezone : 'Asia/Tashkent';
  const recDir = PATH_RE.test(opts.recordingsDir)
    ? opts.recordingsDir.replace(/\/+$/, '')
    : '/var/spool/asterisk/monitor/clary';
  const tenants = cleanTenants(cfg);
  const L = header(tenants.length);

  // --- Operator: line= parametrisiz kelgan qo'ng'iroq — raqam/login bo'yicha ---
  L.push(
    '',
    '[clary-pbx-provider]',
    '; Request-URI foydalanuvchisi (login yoki raqam) → klinika. Mos kelmasa — 404.',
  );
  const keys = new Set<string>();
  for (const t of tenants) {
    if (!t.trunk) continue;
    const cand = [t.code, t.trunk.username];
    if (t.trunk.did) {
      const d = t.trunk.did.slice(1);
      cand.push(d, `+${d}`, d.slice(3));
    }
    for (const k of cand) {
      if (!/^[A-Za-z0-9+][A-Za-z0-9+.-]{0,63}$/.test(k) || keys.has(k)) continue;
      keys.add(k);
      L.push(`exten => ${k},1,Goto(t-${t.code}-in,s,1)`);
    }
  }

  for (const t of tenants) {
    const c = t.code;
    const ai = opts.aiAvailable && t.ai_fallback === 'ai';
    // AI tanlangan-u, nutq serverlari ishlamayapti — ovozli xabarga
    const vm = t.ai_fallback === 'voicemail' || (t.ai_fallback === 'ai' && !opts.aiAvailable);
    const ringers = t.extensions.filter((e) => e.ring);
    const recLines = (indent = ' same => n,') =>
      t.record
        ? [`${indent}Set(CLARY_REC=1)`, `${indent}MixMonitor(${recDir}/${c}/\${CALL_UUID}.wav,b)`]
        : [];

    L.push('', `; ===== ${c} — ${commentText(t.name)} =====`);

    // --- Qabulxona guruhi (jiringlaydigan raqamlarning onlayn qurilmalari) ---
    L.push(`[t-${c}-group]`, 'exten => s,1,Set(CLARY_T=)');
    for (const e of ringers) {
      L.push(` same => n,Gosub(clary-pbx-append,s,1(${e.phone_user}))`);
      L.push(` same => n,Gosub(clary-pbx-append,s,1(${e.web_user}))`);
    }
    L.push(' same => n,Return()');

    if (t.trunk) {
      const tr = t.trunk;
      // --- Trunk (line= orqali aniqlangan) → kiruvchi ---
      L.push(
        '',
        `[t-${c}-trunk]`,
        `exten => s,1,Goto(t-${c}-in,s,1)`,
        `exten => _X!,1,Goto(t-${c}-in,s,1)`,
        `exten => _+X!,1,Goto(t-${c}-in,s,1)`,
        `exten => _[a-zA-Z]!,1,Goto(t-${c}-in,s,1)`,
        'exten => h,1,NoOp()',
      );

      // --- Kiruvchi: guruh jiringlaydi → hech kim olmasa AI ---
      L.push(
        '',
        `[t-${c}-in]`,
        `exten => s,1,NoOp(Clary ATS ${c}: kiruvchi \${CALLERID(num)})`,
        ` same => n,Set(CLARY_TENANT=${c})`,
        ` same => n,Set(CLARY_LINE=trunk-${c})`,
        ` same => n,Set(CLARY_DID=${tr.did ?? ''})`,
        ` same => n,Set(CALL_UUID=${UUID_EXPR})`,
        ' same => n,Set(CLARY_DIR=in)',
        ' same => n,Set(CLARY_FROM=${CALLERID(num)})',
        ` same => n,Set(CLARY_TO=${tr.did ?? ''})`,
        ' same => n,Set(CLARY_START=${EPOCH})',
        ' same => n,Set(CHANNEL(hangup_handler_push)=clary-pbx-hangup,s,1)',
        ...recLines(),
      );
      // Hech kim olmasa: AI (nutq serverlari ishlayotgan bo'lsa) → ovozli xabar → faqat xabar
      const fallback = ai ? 'ai' : vm ? 'vm' : 'msg';
      const fbTarget =
        fallback === 'ai'
          ? 'clary-ai,s,1'
          : fallback === 'vm'
            ? `t-${c}-in,vm,1`
            : `t-${c}-in,noanswer,1`;
      const ranges = timeRanges(t.hours);
      if (fallback !== 'msg' && t.after_hours === 'ai' && ranges.length) {
        for (const d of closedDays(t.closed_dates)) {
          L.push(` same => n,GotoIfTime(*,*,${d.mday},${d.month},${tz}?fb)`);
        }
        for (const r of ranges) {
          L.push(` same => n,GotoIfTime(${r.times},${r.weekday},*,*,${tz}?ring)`);
        }
        L.push(' same => n,Goto(fb)');
      }
      L.push(
        ` same => n(ring),Gosub(t-${c}-group,s,1)`,
        ' same => n,GotoIf($[${LEN(${CLARY_T})} = 0]?fb)',
        ` same => n,Dial(\${CLARY_T},${fallback === 'msg' ? Math.max(t.ring_timeout, 45) : t.ring_timeout})`,
        ' same => n,GotoIf($["${DIALSTATUS}" = "ANSWER"]?end)',
        ` same => n(fb),Goto(${fbTarget})`,
        ' same => n(end),Hangup()',
      );

      // --- Ovozli xabar (AI'siz, uchinchi tomonsiz): signal → yozuv → Clary ---
      L.push(
        `exten => vm,1,NoOp(Clary ATS ${c}: ovozli xabar)`,
        ' same => n,Set(CLARY_VM=1)',
        ' same => n,Answer()',
        ' same => n,Wait(0.5)',
        ' same => n,Playback(clary/vm_prompt)',
        // signal (beep), 5 s jimlik yoki 120 s — tugaydi; k: go'shak qo'yilsa ham saqlanadi
        ` same => n,Record(${recDir}/${c}/\${CALL_UUID}-vm.wav,5,120,k)`,
        ' same => n,Playback(clary/vm_thanks)',
        ' same => n,Hangup()',
        'exten => noanswer,1,Answer()',
        ' same => n,Playback(clary/pbx_noanswer)',
        ' same => n,Hangup()',
      );

      // --- AI odamga ulasa (yoki AI ishlamasa): guruh yana jiringlaydi ---
      L.push(
        `exten => xfer,1,NoOp(Clary ATS ${c}: AI odamga ulamoqda)`,
        ' same => n,Set(CLARY_XFER=1)',
        ` same => n,Gosub(t-${c}-group,s,1)`,
        ' same => n,GotoIf($[${LEN(${CLARY_T})} = 0]?fail)',
        ' same => n,Dial(${CLARY_T},40,r)',
        ' same => n,GotoIf($["${DIALSTATUS}" = "ANSWER"]?end)',
        ' same => n(fail),Playback(clary/transfer_fail)',
        ' same => n(end),Hangup()',
      );
    }

    // --- Ichki raqamlardan (stol telefoni / softfon) ---
    L.push('', `[t-${c}-ext]`);
    for (const e of t.extensions) {
      L.push(
        `exten => ${e.ext},1,Set(CLARY_T=)`,
        ` same => n,Gosub(clary-pbx-append,s,1(${e.phone_user}))`,
        ` same => n,Gosub(clary-pbx-append,s,1(${e.web_user}))`,
        ' same => n,GotoIf($[${LEN(${CLARY_T})} = 0]?na)',
        ' same => n,Dial(${CLARY_T},30)',
        ' same => n,Hangup()',
        ' same => n(na),Playback(clary/ext_unavailable)',
        ' same => n,Hangup()',
      );
    }
    L.push('exten => _[2-8]XX,1,Playback(clary/ext_unavailable)', ' same => n,Hangup()');
    if (t.trunk) {
      // Faqat O'zbekiston raqamlari (xalqaro yopiq — firibgarlikdan himoya) va favqulodda 101–104, 112
      L.push(
        `exten => _XXXXXXXXX,1,Goto(t-${c}-out,998\${EXTEN},1)`,
        `exten => _998XXXXXXXXX,1,Goto(t-${c}-out,\${EXTEN},1)`,
        `exten => _+998XXXXXXXXX,1,Goto(t-${c}-out,\${EXTEN:1},1)`,
        `exten => _10[1-4],1,Goto(t-${c}-out,\${EXTEN},1)`,
        `exten => 112,1,Goto(t-${c}-out,\${EXTEN},1)`,
      );

      const tr = t.trunk;
      L.push(
        '',
        `[t-${c}-out]`,
        `exten => _998XXXXXXXXX,1,Set(CLARY_NUM=${dialNumberExpr(tr.dial_format)})`,
        ` same => n,Goto(t-${c}-out-go,s,1)`,
        'exten => _10[1-4],1,Set(CLARY_NUM=${EXTEN})',
        ' same => n,Set(CLARY_EMERG=1)',
        ` same => n,Goto(t-${c}-out-go,s,1)`,
        'exten => 112,1,Set(CLARY_NUM=${EXTEN})',
        ' same => n,Set(CLARY_EMERG=1)',
        ` same => n,Goto(t-${c}-out-go,s,1)`,
        '',
        `[t-${c}-out-go]`,
        `exten => s,1,NoOp(Clary ATS ${c}: chiquvchi \${CLARY_EXT} -> \${CLARY_NUM})`,
        ' same => n,GotoIf($["${CLARY_EMERG}" = "1"]?go)',
        ' same => n,GotoIf($["${CLARY_CAN_OUT}" != "1"]?denied)',
        ` same => n,Set(GROUP(clary-out)=${c})`,
        ` same => n,GotoIf($[\${GROUP_COUNT(${c}@clary-out)} > ${t.max_outbound}]?busy)`,
        ` same => n(go),Set(CALL_UUID=${UUID_EXPR})`,
        ` same => n,Set(CLARY_TENANT=${c})`,
        ' same => n,Set(CLARY_DIR=out)',
        ' same => n,Set(CLARY_FROM=${CLARY_EXT})',
        ' same => n,Set(CLARY_TO=${CLARY_NUM})',
        ' same => n,Set(CLARY_PEER=${CHANNEL(endpoint)})',
        ' same => n,Set(CLARY_START=${EPOCH})',
        ' same => n,Set(CHANNEL(hangup_handler_push)=clary-pbx-hangup,s,1)',
        ...recLines(),
        ` same => n,Set(CALLERID(num)=${tr.username})`,
        ` same => n,Dial(PJSIP/\${CLARY_NUM}@trunk-${c},90)`,
        ' same => n,Hangup()',
        ' same => n(denied),Playback(clary/out_denied)',
        ' same => n,Hangup()',
        ' same => n(busy),Playback(clary/out_busy)',
        ' same => n,Hangup()',
      );
    } else {
      L.push(
        '; Tashqi liniya (trunk) hali sozlanmagan',
        'exten => _X.,1,Playback(clary/out_denied)',
        ' same => n,Hangup()',
        'exten => _+X.,1,Playback(clary/out_denied)',
        ' same => n,Hangup()',
      );
    }
  }
  return `${L.join('\n')}\n`;
}
