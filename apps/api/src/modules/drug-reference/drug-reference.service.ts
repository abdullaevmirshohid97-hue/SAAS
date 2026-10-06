import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import {
  MXIK_HARVEST_TARGETS,
  barcodeLookupKeys,
  mapMxikRow,
  normalizeBarcode,
  parseGtins,
  parseScan,
  pickPackageCode,
  type DrugRefKind,
  type DrugReferenceRow,
  type MxikPackage,
} from '@clary/utils';

import { SupabaseService } from '../../common/services/supabase.service';
import type { AdoptInput, RegistryRow } from './drug-reference.schemas';
import { MxikClient } from './mxik-client';

// =============================================================================
// Davlat dori katalogi (MXIK) — qidiruv, shtrix-kod, dorini qo'shish, sinxron
// =============================================================================
//   search()      — dorixona: 1–2 harfdan nom bo'yicha (prixod, yangi dori formasi)
//   lookupCode()  — skaner kodi: katalog → (bo'lmasa) MXIK API'ga jonli so'rov
//   adopt()       — katalogdagi dorini klinika bazasiga (MXIK, qadoq kodi, QQS bilan)
//   startSync()   — MXIK'dan to'liq yig'ish (fon rejimida; har kuni tekshiriladi)
//   registry*()   — davlat reestri Excel'i (super admin) → ro'yxat holati
// =============================================================================

const TZ = 'Asia/Tashkent';
const PAGE = 1000;
const CHUNK = 1000;
/** Sahifalar orasidagi pauza — davlat serverini yuklamaslik uchun. */
const PAGE_PAUSE_MS = 300;
/** Shuncha kun sinxronda ko'rinmagan yozuv nofaol bo'ladi (bir martalik uzilish o'chirmaydi). */
const STALE_DAYS = 20;
const LIVE_MISS_TTL_MS = 6 * 3_600_000;
const PACKAGES_TTL_MS = 30 * 86_400_000;

const REF_COLS =
  'mxik_code, kind, name, manufacturer, attribute, form, strength, pack_qty, blister_qty, ' +
  'unit_name, generic_name, atc_code, subposition_name, vat_exempt, reg_active, rx_required';

export interface DrugReferenceHit {
  mxik_code: string;
  kind: DrugRefKind;
  name: string;
  manufacturer: string | null;
  attribute: string | null;
  form: string | null;
  strength: string | null;
  pack_qty: number;
  blister_qty: number | null;
  unit_name: string | null;
  generic_name: string | null;
  atc_code: string | null;
  subposition_name: string | null;
  vat_exempt: boolean;
  reg_active: boolean | null;
  rx_required: boolean | null;
  barcode?: string | null;
  /** Klinikada shu MXIK'li dori bor bo'lsa — uning ID'si. */
  medication_id?: string | null;
}

export interface ReferenceLookup {
  reference: DrugReferenceHit | null;
  /** 'mxik' — rasmiy; 'clinic' — boshqa dorixonalar biriktirgan; 'live' — hozir MXIK'dan. */
  source: 'mxik' | 'clinic' | 'live' | null;
  confirmations: number;
}

export type ClassProgress = {
  label: string;
  total: number;
  fetched: number;
  mapped: number;
  upserted: number;
  complete: boolean;
  error: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

@Injectable()
export class DrugReferenceService {
  private readonly log = new Logger('DrugReference');
  private syncing = false;
  private readonly liveMiss = new Map<string, number>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly mxik: MxikClient,
  ) {}

  // ---------------------------------------------------------------------------
  // Qidiruv
  // ---------------------------------------------------------------------------
  async search(
    clinicId: string | null,
    q: string,
    kind?: DrugRefKind,
    limit = 30,
  ): Promise<DrugReferenceHit[]> {
    const text = (q ?? '').trim();
    if (!text) return [];
    const admin = this.supabase.admin();
    const { data, error } = await admin.rpc(
      'drug_reference_search' as never,
      { p_q: text.slice(0, 200), p_limit: limit, p_kind: kind ?? null } as never,
    );
    if (error) throw new BadRequestException(error.message);
    const hits = (data ?? []) as DrugReferenceHit[];
    if (!clinicId || hits.length === 0) return hits;
    return this.markInClinic(clinicId, hits);
  }

  /** Klinikada allaqachon bor dorilarni belgilash (takror qo'shilmasin). */
  private async markInClinic(clinicId: string, hits: DrugReferenceHit[]) {
    const { data } = await this.supabase
      .admin()
      .from('medications')
      .select('id, mxik_code')
      .eq('clinic_id', clinicId)
      .eq('is_archived', false)
      .in(
        'mxik_code',
        hits.map((h) => h.mxik_code),
      );
    const byMxik = new Map<string, string>();
    for (const m of (data ?? []) as Array<{ id: string; mxik_code: string }>) {
      if (!byMxik.has(m.mxik_code)) byMxik.set(m.mxik_code, m.id);
    }
    return hits.map((h) => ({ ...h, medication_id: byMxik.get(h.mxik_code) ?? null }));
  }

  // ---------------------------------------------------------------------------
  // Shtrix-kod
  // ---------------------------------------------------------------------------
  async lookupCode(
    code: string,
    opts: { live?: boolean; clinicId?: string | null } = {},
  ): Promise<ReferenceLookup> {
    const empty: ReferenceLookup = { reference: null, source: null, confirmations: 0 };
    const keys = barcodeLookupKeys(code).filter((k) => /^\d{14}$/.test(k));
    if (keys.length === 0) return empty;
    const admin = this.supabase.admin();
    const { data: codes, error } = await admin
      .from('drug_reference_barcodes')
      .select('code, mxik_code, source, confirmations')
      .in('code', keys);
    if (error) throw new BadRequestException(error.message);
    const list = (
      (codes ?? []) as Array<{
        mxik_code: string;
        source: 'mxik' | 'clinic';
        confirmations: number;
      }>
    ).sort(
      (a, b) =>
        Number(b.source === 'mxik') - Number(a.source === 'mxik') ||
        b.confirmations - a.confirmations,
    );
    if (list.length) {
      const { data: refs } = await admin
        .from('drug_reference')
        .select(REF_COLS)
        .eq('is_active', true)
        .in(
          'mxik_code',
          list.map((x) => x.mxik_code),
        );
      const byCode = new Map(
        ((refs ?? []) as unknown as DrugReferenceHit[]).map((r) => [r.mxik_code, r]),
      );
      for (const x of list) {
        const ref = byCode.get(x.mxik_code);
        if (!ref) continue;
        const [hit] = opts.clinicId ? await this.markInClinic(opts.clinicId, [ref]) : [ref];
        return {
          reference: { ...hit!, barcode: keys[0]! },
          source: x.source,
          confirmations: x.confirmations,
        };
      }
    }
    if (!opts.live) return empty;
    const live = await this.liveLookup(keys[0]!);
    if (!live) return empty;
    const [hit] = opts.clinicId ? await this.markInClinic(opts.clinicId, [live]) : [live];
    return { reference: { ...hit!, barcode: keys[0]! }, source: 'live', confirmations: 0 };
  }

  /** Katalogda yo'q kod — MXIK API'dan so'raymiz (6 soat ichida qayta so'ralmaydi). */
  private async liveLookup(gtin14: string): Promise<DrugReferenceHit | null> {
    const missAt = this.liveMiss.get(gtin14);
    if (missAt && Date.now() - missAt < LIVE_MISS_TTL_MS) return null;
    try {
      const rows = await this.mxik.searchByGtin(gtin14);
      const mapped = rows
        .filter((r) => parseGtins(r.gtin).includes(gtin14))
        .map((r) => mapMxikRow(r))
        .filter((r): r is DrugReferenceRow => !!r);
      if (mapped.length === 0) {
        this.remember(gtin14);
        return null;
      }
      const admin = this.supabase.admin();
      const { error } = await admin.rpc(
        'drug_reference_upsert' as never,
        { p_rows: mapped, p_source: 'live' } as never,
      );
      if (error) throw new Error(error.message);
      const { data } = await admin
        .from('drug_reference')
        .select(REF_COLS)
        .eq('mxik_code', mapped[0]!.mxik_code)
        .maybeSingle();
      return (data as unknown as DrugReferenceHit | null) ?? null;
    } catch (e) {
      this.log.warn(`MXIK jonli so'rov (${gtin14}): ${errMsg(e)}`);
      this.remember(gtin14);
      return null;
    }
  }

  private remember(gtin14: string) {
    if (this.liveMiss.size > 5000) this.liveMiss.clear();
    this.liveMiss.set(gtin14, Date.now());
  }

  /**
   * Excel faktura: klinikada topilmagan qatorlar uchun katalogdagi mos dori
   * (shtrix-kod, bo'lmasa MXIK kodi). Jonli so'rov yo'q — yuzlab qator bo'lishi mumkin.
   */
  async matchForImport(
    rows: Array<{ idx: number; barcode?: string; mxik?: string }>,
  ): Promise<Map<number, DrugReferenceHit>> {
    const out = new Map<number, DrugReferenceHit>();
    if (rows.length === 0) return out;
    const admin = this.supabase.admin();
    const keysByIdx = new Map<number, string[]>();
    for (const r of rows) {
      if (r.barcode) {
        const keys = barcodeLookupKeys(r.barcode).filter((k) => /^\d{14}$/.test(k));
        if (keys.length) keysByIdx.set(r.idx, keys);
      }
    }
    const allKeys = [...new Set([...keysByIdx.values()].flat())];
    const mxikByCode = new Map<string, string>();
    for (let i = 0; i < allKeys.length; i += 500) {
      const { data } = await admin
        .from('drug_reference_barcodes')
        .select('code, mxik_code, source, confirmations')
        .in('code', allKeys.slice(i, i + 500));
      const sorted = (
        (data ?? []) as Array<{
          code: string;
          mxik_code: string;
          source: string;
          confirmations: number;
        }>
      ).sort(
        (a, b) =>
          Number(b.source === 'mxik') - Number(a.source === 'mxik') ||
          b.confirmations - a.confirmations,
      );
      for (const x of sorted) if (!mxikByCode.has(x.code)) mxikByCode.set(x.code, x.mxik_code);
    }
    const wanted = new Map<number, string>();
    for (const r of rows) {
      const viaCode = (keysByIdx.get(r.idx) ?? []).map((k) => mxikByCode.get(k)).find(Boolean);
      const mx = viaCode ?? (r.mxik && /^\d{17}$/.test(r.mxik.trim()) ? r.mxik.trim() : null);
      if (mx) wanted.set(r.idx, mx);
    }
    const codes = [...new Set(wanted.values())];
    const refs = new Map<string, DrugReferenceHit>();
    for (let i = 0; i < codes.length; i += 500) {
      const { data } = await admin
        .from('drug_reference')
        .select(REF_COLS)
        .eq('is_active', true)
        .in('mxik_code', codes.slice(i, i + 500));
      for (const r of (data ?? []) as unknown as DrugReferenceHit[]) refs.set(r.mxik_code, r);
    }
    for (const [idx, mx] of wanted) {
      const ref = refs.get(mx);
      if (ref) out.set(idx, ref);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Qadoq kodlari (fiskal chek) — birinchi so'ralganda MXIK'dan, keyin bazadan
  // ---------------------------------------------------------------------------
  private async ensurePackages(r: {
    mxik_code: string;
    packages: MxikPackage[] | null;
    packages_fetched_at: string | null;
  }): Promise<MxikPackage[]> {
    if (Array.isArray(r.packages)) return r.packages;
    const stale =
      !r.packages_fetched_at || Date.now() - Date.parse(r.packages_fetched_at) > PACKAGES_TTL_MS;
    if (!stale) return [];
    try {
      const packages = await this.mxik.packages(r.mxik_code);
      await this.supabase
        .admin()
        .from('drug_reference')
        .update({ packages, packages_fetched_at: new Date().toISOString() })
        .eq('mxik_code', r.mxik_code);
      return packages;
    } catch (e) {
      this.log.warn(`Qadoq kodlari (${r.mxik_code}): ${errMsg(e)}`);
      return [];
    }
  }

  /** Yangi dori formasi uchun: qadoq kodlari va tavsiya etilgan kod. */
  async packagesFor(mxikCode: string, sellByUnit = false) {
    const { data, error } = await this.supabase
      .admin()
      .from('drug_reference')
      .select('mxik_code, pack_qty, packages, packages_fetched_at')
      .eq('mxik_code', mxikCode)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Davlat katalogida topilmadi');
    const r = data as {
      mxik_code: string;
      pack_qty: number;
      packages: MxikPackage[] | null;
      packages_fetched_at: string | null;
    };
    const packages = await this.ensurePackages(r);
    return { packages, package_code: pickPackageCode(packages, r.pack_qty, sellByUnit) };
  }

  // ---------------------------------------------------------------------------
  // Katalogdagi dorini klinika bazasiga qo'shish
  // ---------------------------------------------------------------------------
  async adopt(clinicId: string, userId: string, input: AdoptInput) {
    const admin = this.supabase.admin();
    const { data: ref, error } = await admin
      .from('drug_reference')
      .select('mxik_code, pack_qty, packages, packages_fetched_at')
      .eq('mxik_code', input.mxik_code)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!ref) throw new NotFoundException('Davlat katalogida topilmadi');
    const r = ref as {
      mxik_code: string;
      pack_qty: number;
      packages: MxikPackage[] | null;
      packages_fetched_at: string | null;
    };
    let packages = await this.ensurePackages(r);
    // Server MXIK'ga ulana olmasa — brauzer olib kelgan qadoq kodlari (o'sha API'dan)
    if (packages.length === 0 && input.packages?.length) {
      packages = input.packages;
      if (!Array.isArray(r.packages) || r.packages.length === 0) {
        await admin
          .from('drug_reference')
          .update({ packages, packages_fetched_at: new Date().toISOString() })
          .eq('mxik_code', r.mxik_code);
      }
    }
    const packageCode = pickPackageCode(packages, r.pack_qty, !!input.sell_by_unit);

    let barcode: string | null = null;
    if (input.barcode?.trim()) {
      const p = parseScan(input.barcode);
      barcode = p.gtin ?? (normalizeBarcode(p.raw) || null);
    }
    const { data, error: rpcErr } = await admin.rpc(
      'pharmacy_adopt_reference' as never,
      {
        p_clinic: clinicId,
        p_user: userId,
        p_mxik: r.mxik_code,
        p_barcode: barcode,
        p_sell_by_unit: input.sell_by_unit ?? null,
        p_package_code: packageCode,
      } as never,
    );
    if (rpcErr) throw new BadRequestException(rpcErr.message);
    return data as unknown as { medication_id: string; created: boolean; reason?: string };
  }

  // ---------------------------------------------------------------------------
  // MXIK sinxronlash
  // ---------------------------------------------------------------------------
  /** Har kuni 04:10 — oxirgi muvaffaqiyatli sinxron 6.5 kundan eski bo'lsa ishga tushadi. */
  @Cron('10 4 * * *', { timeZone: TZ, name: 'drug-reference-sync' })
  async scheduledSync(): Promise<void> {
    if (process.env.DRUG_REFERENCE_SYNC === 'off') return;
    try {
      const { data } = await this.supabase
        .admin()
        .from('drug_reference_sync_log')
        .select('started_at')
        .eq('source', 'mxik')
        .in('status', ['ok', 'partial'])
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const last = (data as { started_at: string } | null)?.started_at;
      if (last && Date.now() - Date.parse(last) < 6.5 * 86_400_000) return;
      await this.startSync(null);
    } catch (e) {
      this.log.warn(`Rejali sinxron: ${errMsg(e)}`);
    }
  }

  async startSync(triggeredBy: string | null): Promise<{ id: string; already_running: boolean }> {
    const admin = this.supabase.admin();
    const { data: running } = await admin
      .from('drug_reference_sync_log')
      .select('id, started_at')
      .eq('source', 'mxik')
      .eq('status', 'running')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const run = running as { id: string; started_at: string } | null;
    if (run) {
      const fresh = Date.now() - Date.parse(run.started_at) < 3 * 3_600_000;
      if (this.syncing && fresh) return { id: run.id, already_running: true };
      // API qayta ishga tushgan — eski "running" yozuv yopiladi
      await admin
        .from('drug_reference_sync_log')
        .update({
          status: 'error',
          finished_at: new Date().toISOString(),
          error: 'Tugallanmagan (API qayta ishga tushgan)',
        })
        .eq('id', run.id);
    }
    if (this.syncing) throw new BadRequestException('Sinxronlash allaqachon ketmoqda');

    const { data: row, error } = await admin
      .from('drug_reference_sync_log')
      .insert({ source: 'mxik', status: 'running', triggered_by: triggeredBy })
      .select('id, started_at')
      .single();
    if (error) throw new BadRequestException(error.message);
    const log = row as { id: string; started_at: string };
    this.syncing = true;
    void this.runSync(log.id, log.started_at);
    return { id: log.id, already_running: false };
  }

  private async runSync(logId: string, startedAt: string): Promise<void> {
    const admin = this.supabase.admin();
    const classes: Record<string, ClassProgress> = {};
    let fetched = 0;
    let upserted = 0;
    const save = (patch: Record<string, unknown>) =>
      admin
        .from('drug_reference_sync_log')
        .update({ rows_fetched: fetched, rows_upserted: upserted, details: { classes }, ...patch })
        .eq('id', logId);
    try {
      for (const t of MXIK_HARVEST_TARGETS) {
        const key = t.subPositionCode ?? t.classCode;
        const p: ClassProgress = {
          label: t.label,
          total: 0,
          fetched: 0,
          mapped: 0,
          upserted: 0,
          complete: false,
          error: null,
        };
        classes[key] = p;
        // Server MXIK'ga umuman ulana olmayapti — qolgan sinflarni bekorga kutmaymiz
        if (!this.mxik.isAvailable()) {
          p.error = this.mxik.status().last_error ?? 'MXIK API serverdan yopiq';
          continue;
        }
        try {
          for (let page = 0; page < 500; page++) {
            const { rows, total } = await this.mxik.classPage(t, page, PAGE);
            if (page === 0) p.total = total;
            if (rows.length === 0) break;
            p.fetched += rows.length;
            const mapped = rows
              .filter((r) => !t.subPositionCode || r.mxikCode.startsWith(t.subPositionCode))
              .map((r) => mapMxikRow(r, t.kind))
              .filter((r): r is DrugReferenceRow => !!r);
            p.mapped += mapped.length;
            for (let i = 0; i < mapped.length; i += CHUNK) {
              const { data, error } = await admin.rpc(
                'drug_reference_upsert' as never,
                { p_rows: mapped.slice(i, i + CHUNK), p_source: 'mxik' } as never,
              );
              if (error) throw new Error(error.message);
              p.upserted += Number(data) || 0;
            }
            if (p.fetched >= p.total || rows.length < PAGE) break;
            await sleep(PAGE_PAUSE_MS);
          }
          p.complete = p.total > 0 && p.fetched >= Math.floor(p.total * 0.98);
        } catch (e) {
          p.error = errMsg(e);
          this.log.warn(`MXIK ${key}: ${p.error}`);
        }
        fetched += p.fetched;
        upserted += p.upserted;
        await save({});
      }
      const r = await this.finishSync(logId, startedAt, classes);
      this.log.log(`MXIK sinxron: ${r.status}, ${r.upserted} yozuv, ${r.deactivated} nofaol`);
    } catch (e) {
      this.log.error(`MXIK sinxron xato: ${errMsg(e)}`);
      await save({ status: 'error', finished_at: new Date().toISOString(), error: errMsg(e) });
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Yakun (server ham, brauzer ham): to'liq yuklangan sinflarda eski yozuvlar
   * nofaol, dorixonalar kodlari yig'iladi, holat yoziladi.
   */
  private async finishSync(
    logId: string,
    startedAt: string,
    classes: Record<string, ClassProgress>,
    mode: 'server' | 'browser' = 'server',
  ) {
    const admin = this.supabase.admin();
    const complete: string[] = [];
    let fetched = 0;
    let upserted = 0;
    for (const t of MXIK_HARVEST_TARGETS) {
      const p = classes[t.subPositionCode ?? t.classCode];
      if (!p) continue;
      fetched += p.fetched;
      upserted += p.upserted;
      if (p.complete && !p.error && !complete.includes(t.classCode)) complete.push(t.classCode);
    }
    let deactivated = 0;
    if (complete.length) {
      const before = new Date(Date.parse(startedAt) - STALE_DAYS * 86_400_000).toISOString();
      const { data, error } = await admin.rpc(
        'drug_reference_deactivate_stale' as never,
        { p_before: before, p_classes: complete } as never,
      );
      if (error) throw new Error(error.message);
      deactivated = Number(data) || 0;
    }
    const { error: learnErr } = await admin.rpc('drug_reference_learn_backfill' as never);
    if (learnErr) this.log.warn(`Dorixona kodlarini yig'ish: ${learnErr.message}`);

    const allOk = complete.length === new Set(MXIK_HARVEST_TARGETS.map((t) => t.classCode)).size;
    const status = allOk ? 'ok' : upserted > 0 ? 'partial' : 'error';
    const unreachable = mode === 'server' && upserted === 0 && !this.mxik.isAvailable();
    await admin
      .from('drug_reference_sync_log')
      .update({
        status,
        rows_fetched: fetched,
        rows_upserted: upserted,
        rows_deactivated: deactivated,
        details: { classes, mode },
        finished_at: new Date().toISOString(),
        error:
          status === 'ok'
            ? null
            : unreachable
              ? `Server MXIK API'ga ulana olmadi (${this.mxik.status().last_error ?? 'tarmoq'}). "Brauzer orqali yuklash" tugmasidan foydalaning.`
              : 'Ba’zi sinflar to‘liq yuklanmadi — tafsilotda',
      })
      .eq('id', logId);
    return { status, upserted, deactivated };
  }

  // ---------------------------------------------------------------------------
  // Brauzer orqali yuklash — server MXIK'ga ulana olmasa (xorijiy IP bloklangan
  // bo'lishi mumkin). Super admin brauzeri sahifalarni tasnif.soliq.uz'dan oladi
  // (CORS ochiq), @clary/utils bilan bir xil qoida bo'yicha o'giradi va shu
  // yerga bo'laklab yuboradi.
  // ---------------------------------------------------------------------------
  async browserSyncStart(triggeredBy: string | null) {
    if (this.syncing) {
      throw new BadRequestException('Server sinxroni ketmoqda — tugashini kuting');
    }
    const admin = this.supabase.admin();
    // Tugallanmay qolgan (yopilgan sahifa / qayta ishga tushgan API) yozuvlar
    await admin
      .from('drug_reference_sync_log')
      .update({
        status: 'error',
        finished_at: new Date().toISOString(),
        error: 'Tugallanmagan (sahifa yopilgan yoki API qayta ishga tushgan)',
      })
      .eq('source', 'mxik')
      .eq('status', 'running');
    const { data, error } = await admin
      .from('drug_reference_sync_log')
      .insert({
        source: 'mxik',
        status: 'running',
        triggered_by: triggeredBy,
        details: { mode: 'browser' },
      })
      .select('id, started_at')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data as { id: string; started_at: string };
  }

  async browserSyncRows(syncId: string, rows: DrugReferenceRow[]) {
    const admin = this.supabase.admin();
    const { data: log } = await admin
      .from('drug_reference_sync_log')
      .select('status')
      .eq('id', syncId)
      .maybeSingle();
    if ((log as { status: string } | null)?.status !== 'running') {
      throw new BadRequestException('Yuklash seansi topilmadi yoki yakunlangan');
    }
    const { data, error } = await admin.rpc(
      'drug_reference_upsert' as never,
      { p_rows: rows, p_source: 'mxik' } as never,
    );
    if (error) throw new BadRequestException(error.message);
    return { upserted: Number(data) || 0 };
  }

  async browserSyncFinish(syncId: string, classes: Record<string, ClassProgress>) {
    const { data: log } = await this.supabase
      .admin()
      .from('drug_reference_sync_log')
      .select('status, started_at')
      .eq('id', syncId)
      .maybeSingle();
    const l = log as { status: string; started_at: string } | null;
    if (!l || l.status !== 'running') {
      throw new BadRequestException('Yuklash seansi topilmadi yoki yakunlangan');
    }
    return this.finishSync(syncId, l.started_at, classes, 'browser');
  }

  // ---------------------------------------------------------------------------
  // Super admin: statistika va tarix
  // ---------------------------------------------------------------------------
  async stats() {
    const admin = this.supabase.admin();
    const [{ data: stats, error }, { data: logs }] = await Promise.all([
      admin.rpc('drug_reference_stats' as never),
      admin
        .from('drug_reference_sync_log')
        .select(
          'id, source, status, started_at, finished_at, rows_fetched, rows_upserted, rows_deactivated, details, error',
        )
        .order('started_at', { ascending: false })
        .limit(15),
    ]);
    if (error) throw new BadRequestException(error.message);
    return { stats, logs: logs ?? [], syncing: this.syncing, mxik: this.mxik.status() };
  }

  // ---------------------------------------------------------------------------
  // Davlat reestri (uzpharm-control Excel)
  // ---------------------------------------------------------------------------
  async registryImport(importId: string, rows: RegistryRow[]) {
    const { data, error } = await this.supabase
      .admin()
      .rpc('drug_registry_import_rows' as never, { p_import: importId, p_rows: rows } as never);
    if (error) throw new BadRequestException(error.message);
    return { inserted: Number(data) || 0 };
  }

  async registryDiscard(importId: string) {
    const { data, error } = await this.supabase
      .admin()
      .rpc('drug_registry_discard' as never, { p_import: importId } as never);
    if (error) throw new BadRequestException(error.message);
    return { deleted: Number(data) || 0 };
  }

  /** Import tugadi: moslash (bo'laklab) → eski importlar o'chadi → natija. */
  async registryActivate(importId: string, triggeredBy: string | null, fileName?: string | null) {
    const admin = this.supabase.admin();
    const { count } = await admin
      .from('drug_registry')
      .select('id', { count: 'exact', head: true })
      .eq('import_id', importId);
    if (!count) throw new BadRequestException("Import bo'sh — avval qatorlarni yuklang");

    const { data: logRow } = await admin
      .from('drug_reference_sync_log')
      .insert({
        source: 'registry',
        status: 'running',
        triggered_by: triggeredBy,
        rows_fetched: count,
        details: { import_id: importId, file_name: fileName ?? null },
      })
      .select('id')
      .single();
    const logId = (logRow as { id: string } | null)?.id ?? null;
    const finishLog = async (patch: Record<string, unknown>) => {
      if (!logId) return;
      await admin
        .from('drug_reference_sync_log')
        .update({ finished_at: new Date().toISOString(), ...patch })
        .eq('id', logId);
    };

    try {
      const { error: resetErr } = await admin.rpc('drug_registry_reset_matches' as never);
      if (resetErr) throw new Error(resetErr.message);
      const prefixes = [
        ...new Set(
          MXIK_HARVEST_TARGETS.filter((t) => t.kind === 'drug' || t.kind === 'device').map(
            (t) => t.classCode,
          ),
        ),
      ].flatMap((c) => Array.from({ length: 10 }, (_, d) => `${c}${d}`));
      let matched = 0;
      for (const prefix of prefixes) {
        const { data, error } = await admin.rpc(
          'drug_registry_match' as never,
          { p_import: importId, p_prefix: prefix } as never,
        );
        if (error) throw new Error(`${prefix}: ${error.message}`);
        matched += Number(data) || 0;
      }
      const { data: fin, error: finErr } = await admin.rpc(
        'drug_registry_finish' as never,
        { p_import: importId } as never,
      );
      if (finErr) throw new Error(finErr.message);
      await finishLog({
        status: 'ok',
        rows_upserted: matched,
        details: { import_id: importId, file_name: fileName ?? null, result: fin },
      });
      return { matched, ...(fin as Record<string, unknown>) };
    } catch (e) {
      await finishLog({ status: 'error', error: errMsg(e) });
      throw new BadRequestException(`Reestrni moslashda xato: ${errMsg(e)}`);
    }
  }
}
