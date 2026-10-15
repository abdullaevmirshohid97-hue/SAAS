import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, cn } from '@clary/ui-web';
import {
  ArrowRightLeft,
  Delete,
  Grid3x3,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOff,
  Play,
  X,
} from 'lucide-react';

import { api } from '@/lib/api';
import {
  answer,
  dial,
  dialFromApp,
  hangup,
  requestNotificationPermission,
  sendDtmf,
  startSoftphone,
  stopSoftphone,
  toggleHold,
  toggleMute,
  transfer,
} from '@/lib/softphone/engine';
import { prettyNumber } from '@/lib/softphone/numbers';
import { softphoneAvailable, useSoftphone, type SoftphoneCall } from '@/lib/softphone/store';
import { unlockAudio } from '@/lib/softphone/tones';

// =============================================================================
// Clary softfoni — bulutli ATS'ning brauzer/desktop telefoni
// =============================================================================
//   <SoftphoneButton/> — sarlavhadagi 📞 (holat nuqtasi bilan)
//   <SoftphoneRoot/>   — akkaunt, ulanish, kiruvchi qo'ng'iroq oynasi, panel
// Ko'rinadi faqat: klinikada ATS yoqilgan + shu xodimga ichki raqam biriktirilgan.
// =============================================================================

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function duration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// "Qo'ng'iroq" tugmasi (bemor kartasi, qo'ng'iroqlar jurnali) — softfon bo'lsa
// ---------------------------------------------------------------------------
export function CallButton({
  phone,
  name,
  label = 'Qo‘ng‘iroq',
  size = 'sm',
  variant = 'outline',
}: {
  phone: string | null | undefined;
  name?: string | null;
  label?: string;
  size?: 'sm' | 'default' | 'icon';
  variant?: 'outline' | 'default' | 'ghost';
}) {
  const account = useSoftphone((s) => s.account);
  const reg = useSoftphone((s) => s.reg);
  const enabled = useSoftphone((s) => s.enabled);
  if (!phone || !softphoneAvailable(account) || !enabled) return null;
  const ready = reg === 'registered';
  return (
    <Button
      size={size}
      variant={variant}
      disabled={!ready}
      title={ready ? `Qo‘ng‘iroq: ${prettyNumber(phone)}` : 'Telefon ulanmagan'}
      onClick={() => {
        unlockAudio();
        dialFromApp(phone, name ?? null);
      }}
    >
      <Phone className={cn('h-4 w-4', size !== 'icon' && 'mr-1')} />
      {size !== 'icon' && label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Sarlavha tugmasi
// ---------------------------------------------------------------------------
export function SoftphoneButton() {
  const account = useSoftphone((s) => s.account);
  const reg = useSoftphone((s) => s.reg);
  const enabled = useSoftphone((s) => s.enabled);
  const call = useSoftphone((s) => s.call);
  const panelOpen = useSoftphone((s) => s.panelOpen);
  const setPanelOpen = useSoftphone((s) => s.setPanelOpen);
  if (!softphoneAvailable(account)) return null;

  const dot = !enabled
    ? 'bg-muted-foreground/40'
    : reg === 'registered'
      ? 'bg-emerald-500'
      : reg === 'failed'
        ? 'bg-red-500'
        : 'bg-amber-400';
  const title = !enabled
    ? 'Telefon o‘chirilgan'
    : reg === 'registered'
      ? 'Telefon ulangan'
      : reg === 'failed'
        ? 'Telefon ulanmadi'
        : 'Telefon ulanmoqda…';
  const ringing = call?.phase === 'ringing';
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={() => {
        unlockAudio();
        setPanelOpen(!panelOpen);
      }}
      className={cn(
        'hover:bg-accent relative flex h-8 w-8 items-center justify-center rounded-full transition',
        call && call.phase !== 'ended' && 'bg-emerald-500/15 text-emerald-600',
        ringing && 'animate-pulse',
      )}
    >
      {call && call.phase !== 'ended' ? (
        <PhoneCall className="h-4 w-4" />
      ) : (
        <Phone className="h-4 w-4" />
      )}
      <span
        className={cn('ring-background absolute right-1 top-1 h-2 w-2 rounded-full ring-2', dot)}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Ildiz: akkaunt + ulanish + oynalar
// ---------------------------------------------------------------------------
export function SoftphoneRoot() {
  const enabled = useSoftphone((s) => s.enabled);
  const setAccount = useSoftphone((s) => s.setAccount);
  const account = useSoftphone((s) => s.account);
  const panelOpen = useSoftphone((s) => s.panelOpen);
  const call = useSoftphone((s) => s.call);

  const me = useQuery({
    queryKey: ['telephony', 'me'],
    queryFn: () => api.telephony.me(),
    staleTime: 5 * 60_000,
    // TURN logini 12 soat amal qiladi — 6 soatda yangilanadi
    refetchInterval: 6 * 3600_000,
    retry: false,
  });

  useEffect(() => {
    if (me.data) setAccount(me.data);
    else if (me.error) setAccount(null);
  }, [me.data, me.error, setAccount]);

  useEffect(() => {
    if (account && account.enabled && enabled) startSoftphone(account);
    else stopSoftphone();
  }, [account, enabled]);

  useEffect(() => () => stopSoftphone(), []);

  // Brauzer ovozi foydalanuvchi bosgandan keyin ochiladi — jiring eshitilsin
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  if (!softphoneAvailable(account)) return null;
  return (
    <>
      {call?.direction === 'in' && call.phase === 'ringing' && <IncomingCard call={call} />}
      {(panelOpen || (call && !(call.direction === 'in' && call.phase === 'ringing'))) && (
        <SoftphonePanel />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Kiruvchi qo'ng'iroq oynasi
// ---------------------------------------------------------------------------
function PatientHint({ call }: { call: SoftphoneCall }) {
  const p = call.lookup?.patients ?? [];
  if (p.length === 0) {
    return call.lookup ? (
      <div className="text-muted-foreground text-xs">Bazada yo‘q — yangi bemor</div>
    ) : null;
  }
  return (
    <div className="space-y-1">
      {p.slice(0, 2).map((x) => (
        <div key={x.id} className="text-xs">
          <Link to={`/patients/${x.id}`} className="text-primary font-medium hover:underline">
            {x.full_name}
          </Link>
          {x.next_appointment && (
            <span className="text-muted-foreground">
              {' '}
              · navbat{' '}
              {new Date(x.next_appointment.scheduled_at).toLocaleString('uz-UZ', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
              {x.next_appointment.doctor_name ? ` (${x.next_appointment.doctor_name})` : ''}
            </span>
          )}
        </div>
      ))}
      {p.length > 2 && <div className="text-muted-foreground text-xs">yana {p.length - 2} ta</div>}
    </div>
  );
}

function IncomingCard({ call }: { call: SoftphoneCall }) {
  return (
    <div className="bg-card fixed right-4 top-16 z-[60] w-80 rounded-xl border-2 border-emerald-500 p-4 shadow-2xl">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-600">
        <PhoneIncoming className="h-4 w-4 animate-bounce" />
        Kiruvchi qo‘ng‘iroq
      </div>
      <div className="mt-2 text-lg font-semibold">{call.name ?? prettyNumber(call.number)}</div>
      {call.name && (
        <div className="text-muted-foreground text-sm">{prettyNumber(call.number)}</div>
      )}
      <div className="mt-2">
        <PatientHint call={call} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => answer()}>
          <Phone className="mr-1.5 h-4 w-4" />
          Javob berish
        </Button>
        <Button variant="destructive" onClick={() => hangup()}>
          <PhoneOff className="mr-1.5 h-4 w-4" />
          Rad etish
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel: teruvchi / faol qo'ng'iroq
// ---------------------------------------------------------------------------
function SoftphonePanel() {
  const account = useSoftphone((s) => s.account);
  const reg = useSoftphone((s) => s.reg);
  const regError = useSoftphone((s) => s.regError);
  const enabled = useSoftphone((s) => s.enabled);
  const setEnabled = useSoftphone((s) => s.setEnabled);
  const call = useSoftphone((s) => s.call);
  const draft = useSoftphone((s) => s.draft);
  const setDraft = useSoftphone((s) => s.setDraft);
  const setPanelOpen = useSoftphone((s) => s.setPanelOpen);
  const [keypad, setKeypad] = useState(false);
  const [xfer, setXfer] = useState(false);
  const active = !!call && call.phase !== 'ended';
  const now = useNow(active);

  const directory = useQuery({
    queryKey: ['telephony', 'directory'],
    queryFn: () => api.telephony.directory(),
    staleTime: 60_000,
    enabled: xfer || (!active && enabled),
  });

  if (!account || !account.enabled) return null;
  const others = (directory.data ?? []).filter((d) => d.ext !== account.ext);

  return (
    <div className="bg-card fixed right-4 top-16 z-50 w-80 rounded-xl border p-3 shadow-xl">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">
            Telefon · {account.ext} ({account.display_name})
          </div>
          <div className="text-muted-foreground text-xs">
            {!enabled
              ? 'Shu kompyuterda o‘chirilgan'
              : reg === 'registered'
                ? '🟢 Ulangan — qo‘ng‘iroqlar shu yerga keladi'
                : reg === 'failed'
                  ? `🔴 Ulanmadi${regError ? `: ${regError}` : ''}`
                  : `🟡 Ulanmoqda…${regError ? ` (${regError})` : ''}`}
          </div>
        </div>
        {!active && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setPanelOpen(false)}
            aria-label="Yopish"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {call ? (
        <div className="mt-3 space-y-3">
          <div className="rounded-lg bg-emerald-500/10 p-3 text-center">
            <div className="text-muted-foreground text-xs">
              {call.phase === 'calling'
                ? 'Terilmoqda…'
                : call.phase === 'ended'
                  ? (call.cause ?? 'Tugadi')
                  : call.held
                    ? 'Kutishda (hold)'
                    : call.direction === 'in'
                      ? 'Kiruvchi'
                      : 'Chiquvchi'}
            </div>
            <div className="mt-1 text-lg font-semibold">
              {call.name ?? prettyNumber(call.number)}
            </div>
            {call.name && (
              <div className="text-muted-foreground text-sm">{prettyNumber(call.number)}</div>
            )}
            {call.answeredAt && call.phase === 'active' && (
              <div className="mt-1 font-mono text-sm">{duration(now - call.answeredAt)}</div>
            )}
          </div>
          <PatientHint call={call} />

          {call.phase === 'active' && (
            <div className="grid grid-cols-4 gap-2">
              <IconBtn
                label={call.muted ? 'Ovozni yoqish' : 'Ovozsiz'}
                active={call.muted}
                onClick={() => toggleMute()}
              >
                {call.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </IconBtn>
              <IconBtn
                label={call.held ? 'Davom ettirish' : 'Kutish (hold)'}
                active={call.held}
                onClick={() => toggleHold()}
              >
                {call.held ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              </IconBtn>
              <IconBtn label="Tugmalar" active={keypad} onClick={() => setKeypad((v) => !v)}>
                <Grid3x3 className="h-4 w-4" />
              </IconBtn>
              <IconBtn label="Ulash" active={xfer} onClick={() => setXfer((v) => !v)}>
                <ArrowRightLeft className="h-4 w-4" />
              </IconBtn>
            </div>
          )}

          {call.phase === 'active' && keypad && (
            <div className="grid grid-cols-3 gap-1.5">
              {KEYS.map((k) => (
                <Button key={k} variant="outline" size="sm" onClick={() => sendDtmf(k)}>
                  {k}
                </Button>
              ))}
            </div>
          )}

          {call.phase === 'active' && xfer && (
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2">
              <div className="text-muted-foreground text-[11px] font-medium uppercase">
                Kimga ulash
              </div>
              {others.length === 0 && (
                <div className="text-muted-foreground text-xs">Boshqa ichki raqam yo‘q</div>
              )}
              {others.map((d) => (
                <button
                  key={d.ext}
                  type="button"
                  className="hover:bg-accent flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm"
                  onClick={() => {
                    transfer(d.ext);
                    setXfer(false);
                  }}
                >
                  <span>
                    <span className="font-mono">{d.ext}</span> · {d.label}
                  </span>
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full',
                      d.phone_status === 'online' || d.web_status === 'online'
                        ? 'bg-emerald-500'
                        : 'bg-muted-foreground/30',
                    )}
                  />
                </button>
              ))}
            </div>
          )}

          {call.phase !== 'ended' && (
            <Button variant="destructive" className="w-full" onClick={() => hangup()}>
              <PhoneOff className="mr-1.5 h-4 w-4" />
              Tugatish
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {enabled && reg === 'registered' && (
            <>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  requestNotificationPermission();
                  if (dial(draft)) setDraft('');
                }}
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="90 123 45 67 yoki 202"
                  inputMode="tel"
                  className="border-input bg-background h-9 min-w-0 flex-1 rounded-md border px-2 font-mono text-sm"
                  autoFocus
                />
                {draft && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setDraft(draft.slice(0, -1))}
                    aria-label="O‘chirish"
                  >
                    <Delete className="h-4 w-4" />
                  </Button>
                )}
              </form>
              <div className="grid grid-cols-3 gap-1.5">
                {KEYS.map((k) => (
                  <Button key={k} variant="outline" size="sm" onClick={() => setDraft(draft + k)}>
                    {k}
                  </Button>
                ))}
              </div>
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700"
                disabled={!draft}
                onClick={() => {
                  requestNotificationPermission();
                  if (dial(draft)) setDraft('');
                }}
              >
                <Phone className="mr-1.5 h-4 w-4" />
                Qo‘ng‘iroq qilish
              </Button>
              {others.length > 0 && (
                <div className="max-h-40 space-y-0.5 overflow-y-auto">
                  <div className="text-muted-foreground text-[11px] font-medium uppercase">
                    Ichki raqamlar
                  </div>
                  {others.map((d) => (
                    <button
                      key={d.ext}
                      type="button"
                      className="hover:bg-accent flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm"
                      onClick={() => dial(d.ext, d.label)}
                    >
                      <span>
                        <span className="font-mono">{d.ext}</span> · {d.label}
                      </span>
                      <span
                        className={cn(
                          'h-2 w-2 rounded-full',
                          d.phone_status === 'online' || d.web_status === 'online'
                            ? 'bg-emerald-500'
                            : 'bg-muted-foreground/30',
                        )}
                      />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="accent-primary"
              checked={enabled}
              onChange={(e) => {
                unlockAudio();
                requestNotificationPermission();
                setEnabled(e.target.checked);
              }}
            />
            Shu kompyuterda qo‘ng‘iroqlarni qabul qilish
          </label>
          {enabled && reg === 'failed' && (
            <p className="text-muted-foreground text-[11px]">
              Internet va mikrofon ruxsatini tekshiring. Muammo qolsa — administrator “Sozlamalar →
              IP-telefoniya” sahifasida server holatini ko‘rsin.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function IconBtn({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex h-10 items-center justify-center rounded-lg border transition',
        active ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}
