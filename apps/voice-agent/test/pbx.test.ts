import { describe, expect, it } from 'vitest';

import { parseContacts, parseRegistrations } from '../src/pbx/asterisk';
import { parseCdrQuery } from '../src/pbx/cdr';
import {
  callerName,
  closedDays,
  confValue,
  renderDialplan,
  renderPjsip,
  timeRanges,
  type RenderOptions,
} from '../src/pbx/render';
import type { PbxAgentConfig, PbxTenantConf } from '../src/pbx/types';

const HA1 = 'a'.repeat(32);
const HB1 = 'b'.repeat(32);

function tenant(over: Partial<PbxTenantConf> = {}): PbxTenantConf {
  return {
    code: 'magnus',
    clinic_id: '00000000-0000-0000-0000-000000000001',
    name: 'MAGNUS klinikasi',
    trunk: {
      host: 'sip.uztelecom.uz',
      port: 5060,
      transport: 'udp',
      username: '712000000',
      password: 'pa;ss',
      from_domain: 'sip.uztelecom.uz',
      did: '+998712000000',
      dial_format: 'digits12',
    },
    ring_timeout: 20,
    record: true,
    ai_fallback: 'ai',
    after_hours: 'ai',
    hours: [
      { weekday: 1, start: '09:00', end: '18:00' },
      { weekday: 6, start: '09:00', end: '14:00' },
    ],
    closed_dates: ['2026-10-20'],
    max_outbound: 4,
    extensions: [
      {
        ext: '201',
        label: 'Qabulxona',
        phone_user: 'magnus201',
        phone_ha1: HA1,
        web_user: 'magnus201w',
        web_ha1: HB1,
        ring: true,
        can_call_out: true,
      },
      {
        ext: '202',
        label: 'Bosh shifokor',
        phone_user: 'magnus202',
        phone_ha1: HA1,
        web_user: 'magnus202w',
        web_ha1: HB1,
        ring: false,
        can_call_out: false,
      },
    ],
    ...over,
  };
}

function config(tenants: PbxTenantConf[]): PbxAgentConfig {
  return { realm: 'clary', generated_at: '2026-10-15T10:00:00.000Z', tenants };
}

const OPTS: RenderOptions = {
  timezone: 'Asia/Tashkent',
  recordingsDir: '/var/spool/asterisk/monitor/clary',
  aiAvailable: true,
};

describe('pbx render — pjsip', () => {
  it('trunk: registration line=yes, parol ekranlangan, ichki raqamlar HA1 bilan', () => {
    const conf = renderPjsip(config([tenant()]), OPTS);
    expect(conf).toContain('[trunk-magnus]\ntype=registration');
    expect(conf).toContain('line=yes');
    expect(conf).toContain('endpoint=trunk-magnus');
    expect(conf).toContain('password=pa\\;ss');
    expect(conf).toContain('server_uri=sip:sip.uztelecom.uz:5060');
    expect(conf).toContain('client_uri=sip:712000000@sip.uztelecom.uz');
    expect(conf).toContain('[trunk-magnus](clary-trunk)');
    expect(conf).toContain('context=t-magnus-trunk');
    // ichki raqam: stol telefoni va softfon alohida akkaunt, parol emas HA1
    expect(conf).toContain(
      '[magnus201-auth]\ntype=auth\nauth_type=md5\nusername=magnus201\nrealm=clary',
    );
    expect(conf).toContain(`md5_cred=${HA1}`);
    expect(conf).toContain('[magnus201w](clary-ext-webrtc)');
    expect(conf).toContain('callerid="Qabulxona" <201>');
    expect(conf).toContain('set_var=CLARY_CAN_OUT=0'); // 202
    // operator uchun umumiy (line= parametrisiz) endpoint
    expect(conf).toContain(
      '[clary-prov-1]\ntype=identify\nendpoint=clary-prov-1\nmatch=sip.uztelecom.uz',
    );
    // vaqt belgisi yo'q — natija barqaror (keraksiz reload bo'lmasin)
    expect(conf).not.toContain('2026-10-15');
  });

  it('TCP transport', () => {
    const t = tenant();
    t.trunk = { ...t.trunk!, transport: 'tcp', port: 5080 };
    const conf = renderPjsip(config([t]), OPTS);
    expect(conf).toContain('server_uri=sip:sip.uztelecom.uz:5080;transport=tcp');
    expect(conf).toContain('transport=transport-tcp');
  });

  it("in'ektsiya: yangi qator, noto'g'ri host va endpoint nomlari o'tkazib yuboriladi", () => {
    const bad = tenant({ name: 'Klinika\n[evil]\ntype=endpoint' });
    bad.trunk = { ...bad.trunk!, host: 'evil.com\n[x]' };
    bad.extensions = [
      { ...bad.extensions[0]!, label: 'A"\n<b>;c' },
      { ...bad.extensions[1]!, phone_user: 'x\ny' },
    ];
    const conf = renderPjsip(config([bad, tenant({ code: 'BAD CODE' })]), OPTS);
    expect(conf).not.toMatch(/^\[evil\]/m);
    expect(conf).not.toContain('evil.com');
    expect(conf).not.toContain('[trunk-magnus]');
    expect(conf).toContain("; O'TKAZIB YUBORILDI: trunk");
    expect(conf).toContain("; O'TKAZIB YUBORILDI: ichki raqam 202");
    expect(conf).toContain('callerid="Abc" <201>');
    expect(conf).not.toContain('BAD CODE');
  });

  it('yordamchilar', () => {
    expect(confValue('a;b\nc')).toBe('a\\;bc');
    expect(callerName('  ')).toBe('Clary');
    expect(callerName('Qabulxona "1"')).toBe('Qabulxona 1');
  });
});

describe('pbx render — dialplan', () => {
  it('kiruvchi: ish vaqti → guruh → AI; bayram → AI; yozuv', () => {
    const plan = renderDialplan(config([tenant()]), OPTS);
    expect(plan).toContain('[t-magnus-in]');
    expect(plan).toContain(' same => n,Set(CLARY_LINE=trunk-magnus)');
    expect(plan).toContain(' same => n,Set(CLARY_DID=+998712000000)');
    expect(plan).toContain(
      " same => n,Set(CALL_UUID=${SHELL(cat /proc/sys/kernel/random/uuid | tr -d '\\n')})",
    );
    expect(plan).toContain(
      ' same => n,MixMonitor(/var/spool/asterisk/monitor/clary/magnus/${CALL_UUID}.wav,b)',
    );
    expect(plan).toContain(' same => n,GotoIfTime(*,*,20,oct,Asia/Tashkent?ai)');
    expect(plan).toContain(' same => n,GotoIfTime(09:00-17:59,mon,*,*,Asia/Tashkent?ring)');
    expect(plan).toContain(' same => n,GotoIfTime(09:00-13:59,sat,*,*,Asia/Tashkent?ring)');
    expect(plan).toContain(' same => n,Dial(${CLARY_T},20)');
    expect(plan).toContain(' same => n(ai),Goto(clary-ai,s,1)');
    expect(plan).toContain('exten => xfer,1,');
    // guruhda faqat ring=true raqamlar
    const group = plan.slice(plan.indexOf('[t-magnus-group]'), plan.indexOf('[t-magnus-trunk]'));
    expect(group).toContain('Gosub(clary-pbx-append,s,1(magnus201))');
    expect(group).toContain('Gosub(clary-pbx-append,s,1(magnus201w))');
    expect(group).not.toContain('magnus202');
  });

  it('chiquvchi: faqat O‘zbekiston, favqulodda, limit, format', () => {
    const plan = renderDialplan(config([tenant()]), OPTS);
    expect(plan).toContain('exten => _XXXXXXXXX,1,Goto(t-magnus-out,998${EXTEN},1)');
    expect(plan).toContain('exten => _+998XXXXXXXXX,1,Goto(t-magnus-out,${EXTEN:1},1)');
    expect(plan).toContain('exten => _10[1-4],1,Goto(t-magnus-out,${EXTEN},1)');
    expect(plan).toContain('exten => _998XXXXXXXXX,1,Set(CLARY_NUM=${EXTEN})');
    expect(plan).toContain(' same => n,GotoIf($[${GROUP_COUNT(magnus@clary-out)} > 4]?busy)');
    expect(plan).toContain(' same => n,Dial(PJSIP/${CLARY_NUM}@trunk-magnus,90)');
    expect(plan).not.toMatch(/_00X|_810X|_\+X\./); // xalqaro yo'q

    const e164 = tenant();
    e164.trunk = { ...e164.trunk!, dial_format: 'e164' };
    expect(renderDialplan(config([e164]), OPTS)).toContain('Set(CLARY_NUM=+${EXTEN})');
    const local = tenant();
    local.trunk = { ...local.trunk!, dial_format: 'local9' };
    expect(renderDialplan(config([local]), OPTS)).toContain('Set(CLARY_NUM=${EXTEN:3})');
  });

  it('operator konteksti: login, raqam va kod bo‘yicha', () => {
    const plan = renderDialplan(config([tenant()]), OPTS);
    expect(plan).toContain('exten => magnus,1,Goto(t-magnus-in,s,1)');
    expect(plan).toContain('exten => 712000000,1,Goto(t-magnus-in,s,1)');
    expect(plan).toContain('exten => 998712000000,1,Goto(t-magnus-in,s,1)');
    expect(plan).toContain('exten => +998712000000,1,Goto(t-magnus-in,s,1)');
    // login va DID'ning oxirgi 9 raqami bir xil — takror yozilmaydi
    expect(plan.match(/exten => 712000000,/g)).toHaveLength(1);
  });

  it('AI o‘chiq (yoki voice-agent’da STT yo‘q) — uzoqroq jiringlaydi, keyin xabar', () => {
    for (const plan of [
      renderDialplan(config([tenant({ ai_fallback: 'none' })]), OPTS),
      renderDialplan(config([tenant()]), { ...OPTS, aiAvailable: false }),
    ]) {
      expect(plan).not.toContain('Goto(clary-ai,s,1)');
      expect(plan).not.toContain('GotoIfTime');
      expect(plan).toContain(' same => n,Dial(${CLARY_T},45)');
      expect(plan).toContain(' same => n(noanswer),Playback(clary/pbx_noanswer)');
    }
  });

  it('trunk yo‘q — faqat ichki qo‘ng‘iroqlar, tashqi rad', () => {
    const plan = renderDialplan(config([tenant({ trunk: null })]), OPTS);
    expect(plan).not.toContain('[t-magnus-in]');
    expect(plan).toContain('exten => 201,1,Set(CLARY_T=)');
    expect(plan).toContain('exten => _X.,1,Playback(clary/out_denied)');
  });

  it('ish vaqti oraliqlari', () => {
    expect(timeRanges([{ weekday: 0, start: '00:00', end: '24:00' }])).toEqual([
      { times: '00:00-23:59', weekday: 'sun' },
    ]);
    expect(timeRanges([{ weekday: 5, start: '20:00', end: '08:00' }])).toEqual([
      { times: '20:00-23:59', weekday: 'fri' },
      { times: '00:00-07:59', weekday: 'sat' },
    ]);
    expect(timeRanges([{ weekday: 9, start: '09:00', end: '18:00' }])).toEqual([]);
    expect(closedDays(['2026-01-01', '2026-01-01', 'bad'])).toEqual([{ mday: '1', month: 'jan' }]);
  });
});

describe('pbx — Asterisk CLI javoblari', () => {
  it('pjsip show registrations', () => {
    const out = `
 <Registration/ServerURI..............................>  <Auth..........>  <Status.......>
==========================================================================================

 trunk-magnus/sip:sip.uztelecom.uz:5060                  trunk-magnus-auth  Registered        (exp. 245s)
 trunk-shifo/sip:10.1.1.1:5060;transport=tcp             trunk-shifo-auth   Rejected

Objects found: 2
`;
    expect(parseRegistrations(out)).toEqual([
      { endpoint: 'trunk-magnus', status: 'Registered' },
      { endpoint: 'trunk-shifo', status: 'Rejected' },
    ]);
  });

  it('pjsip show contacts', () => {
    const out = `
  Contact:  <Aor/ContactUri..........................> <Hash....> <Status> <RTT(ms)..>
==========================================================================================

  Contact:  magnus201/sip:magnus201@10.0.0.5:5060                  4f6d7a1c2b Avail        23.456
  Contact:  magnus201w/sip:abc@xyz.invalid;transport=ws            8a9b0c1d2e NonQual         nan
  Contact:  trunk-magnus/sip:sip.uztelecom.uz:5060                 1a2b3c4d5e Unavail         nan

Objects found: 3
`;
    expect(parseContacts(out)).toEqual([
      { aor: 'magnus201', status: 'Avail' },
      { aor: 'magnus201w', status: 'NonQual' },
      { aor: 'trunk-magnus', status: 'Unavail' },
    ]);
  });
});

describe('pbx — CDR so‘rovi', () => {
  it('dialplan parametrlari', () => {
    const q = new URLSearchParams({
      uuid: '0B6F7F3C-1C2D-4E5F-8A9B-0C1D2E3F4A5B',
      tenant: 'magnus',
      dir: 'in',
      from: '998901234567',
      to: '+998712000000',
      status: 'NOANSWER',
      peer: '',
      start: '1760500000',
      end: '1760500030',
      answered: '',
      ai: '1',
      xfer: '',
      rec: '1',
      cause: '16',
    });
    const r = parseCdrQuery(q);
    expect(r?.rec).toBe(true);
    expect(r?.cdr).toMatchObject({
      uuid: '0b6f7f3c-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
      direction: 'in',
      dial_status: 'NOANSWER',
      peer: null,
      started: 1760500000,
      answered: null,
      ai: true,
      xfer: false,
    });
    expect(parseCdrQuery(new URLSearchParams({ uuid: 'x', tenant: 'magnus', dir: 'in' }))).toBe(
      null,
    );
    expect(
      parseCdrQuery(
        new URLSearchParams({
          uuid: '0b6f7f3c-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
          tenant: '../etc',
          dir: 'in',
        }),
      ),
    ).toBe(null);
  });
});
