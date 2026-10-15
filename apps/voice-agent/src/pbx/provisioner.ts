import { chownSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Logger } from '../log';

import type { PbxApi } from './api';
import { parseContacts, parseRegistrations, rx } from './asterisk';
import { renderDialplan, renderPjsip, type RenderOptions } from './render';

// =============================================================================
// Bulutli ATS — Asterisk sozlamasini Clary API bilan sinxronlash
// =============================================================================
//   har PBX_SYNC_SEC:   GET /telephony/agent/config → pjsip_clary.conf +
//                       extensions_clary.conf (o'zgargan bo'lsa yozib, reload)
//   har PBX_STATUS_SEC: pjsip show registrations/contacts → POST /telephony/agent/status
// API javob bermasa — mavjud fayllar O'ZGARMAYDI (qo'ng'iroqlar to'xtamaydi).
// =============================================================================

export interface ProvisionerOptions extends Omit<RenderOptions, 'aiAvailable'> {
  confDir: string;
  syncSec: number;
  statusSec: number;
  asteriskBin: string;
  /** Nutq serverlari (STT+TTS) hozir ishlayaptimi — har sinxronda so'raladi */
  aiAvailable: () => boolean;
}

export interface ProvisionerState {
  last_sync_at: number;
  last_ok_at: number;
  last_change_at: number;
  tenants: number;
  reloads: number;
  error: string | null;
  status_error: string | null;
}

export class PbxProvisioner {
  readonly state: ProvisionerState = {
    last_sync_at: 0,
    last_ok_at: 0,
    last_change_at: 0,
    tenants: 0,
    reloads: 0,
    error: null,
    status_error: null,
  };
  private syncing = false;
  private reporting = false;
  // Ishga tushganda bir marta reload (oldingi jarayonda yozilib, reload bo'lmay qolgan bo'lishi mumkin)
  private pendingPjsip = true;
  private pendingDialplan = true;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly api: PbxApi,
    private readonly opts: ProvisionerOptions,
    private readonly log: Logger,
  ) {}

  start() {
    void this.sync();
    this.timers.push(setInterval(() => void this.sync(), this.opts.syncSec * 1000));
    this.timers.push(
      setTimeout(() => {
        void this.report();
        this.timers.push(setInterval(() => void this.report(), this.opts.statusSec * 1000));
      }, 5000),
    );
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /** Fayl o'zgargan bo'lsa atomik yozadi (tmp → rename), egasi — papka egasi (asterisk). */
  private writeIfChanged(name: string, content: string): boolean {
    const file = join(this.opts.confDir, name);
    let old: string | null = null;
    try {
      old = readFileSync(file, 'utf8');
    } catch {
      old = null;
    }
    if (old === content) return false;
    const tmp = `${file}.tmp-${process.pid}`;
    // Ichida trunk parollari bor — boshqalar o'qiy olmasin
    writeFileSync(tmp, content, { mode: 0o640 });
    try {
      const st = statSync(this.opts.confDir);
      chownSync(tmp, st.uid, st.gid);
    } catch {
      /* root emasmiz — fayl baribir joriy foydalanuvchiniki */
    }
    renameSync(tmp, file);
    return true;
  }

  /** Klinika yozuvlari papkasi (MixMonitor asterisk nomidan yozadi). */
  private ensureRecordingDirs(codes: string[]) {
    try {
      mkdirSync(this.opts.recordingsDir, { recursive: true });
      const st = statSync(this.opts.recordingsDir);
      for (const code of codes) {
        const dir = join(this.opts.recordingsDir, code);
        mkdirSync(dir, { recursive: true });
        try {
          chownSync(dir, st.uid, st.gid);
        } catch {
          /* root emas */
        }
      }
    } catch (e) {
      this.log.warn(`yozuvlar papkasi: ${(e as Error).message}`);
    }
  }

  async sync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    this.state.last_sync_at = Date.now();
    try {
      const cfg = await this.api.config();
      const ro: RenderOptions = {
        timezone: this.opts.timezone,
        recordingsDir: this.opts.recordingsDir,
        aiAvailable: this.opts.aiAvailable(),
      };
      const pjsip = renderPjsip(cfg, ro);
      const dialplan = renderDialplan(cfg, ro);
      this.ensureRecordingDirs(cfg.tenants.map((t) => t.code));
      const pjChanged = this.writeIfChanged('pjsip_clary.conf', pjsip);
      const dpChanged = this.writeIfChanged('extensions_clary.conf', dialplan);
      // Reload muvaffaqiyatsiz bo'lsa (Asterisk vaqtincha javob bermadi) — fayl
      // o'zgarmasa ham keyingi sinxronda qayta uriniladi
      this.pendingPjsip ||= pjChanged;
      this.pendingDialplan ||= dpChanged;
      if (this.pendingPjsip) {
        await rx('module reload res_pjsip.so', this.opts.asteriskBin);
        await rx('module reload res_pjsip_outbound_registration.so', this.opts.asteriskBin);
        this.pendingPjsip = false;
      }
      if (this.pendingDialplan) {
        await rx('dialplan reload', this.opts.asteriskBin);
        this.pendingDialplan = false;
      }
      if (pjChanged || dpChanged) {
        this.state.reloads++;
        this.state.last_change_at = Date.now();
        this.log.info(
          `ATS sozlamasi yangilandi: ${cfg.tenants.length} klinika` +
            `${pjChanged ? ' [pjsip]' : ''}${dpChanged ? ' [dialplan]' : ''}`,
        );
      }
      this.state.tenants = cfg.tenants.length;
      this.state.last_ok_at = Date.now();
      this.state.error = null;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== this.state.error) this.log.warn(`ATS sinxron: ${msg}`);
      this.state.error = msg;
    } finally {
      this.syncing = false;
    }
  }

  async report(): Promise<void> {
    if (this.reporting) return;
    this.reporting = true;
    try {
      const [regs, contacts] = await Promise.all([
        rx('pjsip show registrations', this.opts.asteriskBin),
        rx('pjsip show contacts', this.opts.asteriskBin),
      ]);
      await this.api.status({
        registrations: parseRegistrations(regs),
        contacts: parseContacts(contacts),
      });
      this.state.status_error = null;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== this.state.status_error) this.log.warn(`ATS holati: ${msg}`);
      this.state.status_error = msg;
    } finally {
      this.reporting = false;
    }
  }
}
