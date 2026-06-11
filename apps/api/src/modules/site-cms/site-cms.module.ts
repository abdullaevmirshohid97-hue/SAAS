import { spawn } from 'node:child_process';

import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { SupabaseService } from '../../common/services/supabase.service';

const EntrySchema = z.object({
  key: z.string().min(1).max(200),
  kind: z.enum([
    'hero', 'section', 'feature', 'testimonial', 'faq', 'plan',
    'media', 'seo', 'config', 'block',
    'post', 'doc', 'changelog', 'usecase', 'feature_detail', 'download',
  ]),
  content_i18n: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  data: z.record(z.string(), z.unknown()).default({}),
  sort_order: z.number().int().default(0),
  is_visible: z.boolean().default(true),
});

const UpdateEntrySchema = EntrySchema.partial();

const MediaSchema = z.object({
  kind: z.enum(['image', 'video', 'document']),
  url: z.string().url(),
  poster_url: z.string().url().nullable().optional(),
  alt_i18n: z.record(z.string(), z.string()).default({}),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  bytes: z.number().int().nullable().optional(),
  tags: z.array(z.string()).default([]),
});

@Injectable()
class SiteCmsService {
  constructor(private readonly supabase: SupabaseService) {}

  // ----- Public ------------------------------------------------------------
  async publicContent(locale: string) {
    const admin = this.supabase.admin();
    const { data: entries } = await admin
      .from('site_entries')
      .select('key, kind, content_i18n, data, sort_order, is_visible')
      .eq('status', 'published')
      .eq('is_visible', true)
      .order('kind')
      .order('sort_order');

    const by_kind: Record<string, Array<Record<string, unknown>>> = {};
    const by_key: Record<string, Record<string, unknown>> = {};
    const normalized = (entries ?? []).map((e) => {
      const row = e as {
        key: string;
        kind: string;
        content_i18n: Record<string, Record<string, unknown>>;
        data: Record<string, unknown>;
        sort_order: number;
        is_visible: boolean;
      };
      const primary = row.content_i18n[locale] ?? row.content_i18n['uz-Latn'] ?? Object.values(row.content_i18n)[0] ?? {};
      const out = {
        key: row.key,
        kind: row.kind,
        sort_order: row.sort_order,
        content: primary,
        content_i18n: row.content_i18n,
        data: row.data,
      };
      by_kind[row.kind] ??= [];
      by_kind[row.kind]!.push(out);
      by_key[row.key] = out;
      return out;
    });

    const { data: media } = await admin
      .from('site_media')
      .select('id, kind, url, poster_url, alt_i18n, width, height, mime_type, tags, created_at')
      .order('created_at', { ascending: false })
      .limit(120);

    return { locale, entries: normalized, by_kind, by_key, media: media ?? [] };
  }

  // ----- Admin -------------------------------------------------------------
  async listAll() {
    const { data } = await this.supabase
      .admin()
      .from('site_entries')
      .select('*')
      .order('kind')
      .order('sort_order');
    return data ?? [];
  }

  async createEntry(userId: string, input: z.infer<typeof EntrySchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('site_entries')
      .insert({ ...input, status: 'draft', created_by: userId, updated_by: userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async updateEntry(userId: string, id: string, patch: z.infer<typeof UpdateEntrySchema>) {
    const admin = this.supabase.admin();
    const { data: existing } = await admin.from('site_entries').select('*').eq('id', id).single();
    if (!existing) throw new NotFoundException('entry not found');
    const { data, error } = await admin
      .from('site_entries')
      .update({
        ...patch,
        draft_content_i18n: patch.content_i18n ?? null,
        draft_data: patch.data ?? null,
        updated_by: userId,
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async publishEntry(userId: string, id: string, comment?: string) {
    const admin = this.supabase.admin();
    const { data: existing } = await admin.from('site_entries').select('*').eq('id', id).single();
    if (!existing) throw new NotFoundException('entry not found');
    const r = existing as {
      content_i18n: Record<string, unknown>;
      data: Record<string, unknown>;
      sort_order: number;
      is_visible: boolean;
      version: number;
      draft_content_i18n: Record<string, unknown> | null;
      draft_data: Record<string, unknown> | null;
    };
    const nextContent = r.draft_content_i18n ?? r.content_i18n;
    const nextData = r.draft_data ?? r.data;
    const nextVersion = (r.version ?? 1) + 1;

    await admin.from('site_revisions').insert({
      entry_id: id,
      version: nextVersion,
      content_i18n: nextContent,
      data: nextData,
      sort_order: r.sort_order,
      is_visible: r.is_visible,
      comment: comment ?? null,
      created_by: userId,
    });

    const { data, error } = await admin
      .from('site_entries')
      .update({
        content_i18n: nextContent,
        data: nextData,
        draft_content_i18n: null,
        draft_data: null,
        status: 'published',
        published_at: new Date().toISOString(),
        published_by: userId,
        version: nextVersion,
        updated_by: userId,
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async archiveEntry(userId: string, id: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('site_entries')
      .update({ status: 'archived', updated_by: userId })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async listRevisions(entryId: string) {
    const { data } = await this.supabase
      .admin()
      .from('site_revisions')
      .select('*')
      .eq('entry_id', entryId)
      .order('version', { ascending: false });
    return data ?? [];
  }

  async listMedia() {
    const { data } = await this.supabase
      .admin()
      .from('site_media')
      .select('*')
      .order('created_at', { ascending: false });
    return data ?? [];
  }

  async createMedia(userId: string, input: z.infer<typeof MediaSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('site_media')
      .insert({ ...input, created_by: userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async deleteMedia(id: string) {
    await this.supabase.admin().from('site_media').delete().eq('id', id);
    return { ok: true };
  }
}

// =============================================================================
// SiteRebuildService — landing saytni qayta qurish (deploy) triggeri.
// CMS o'zgarishlari statik saytda faqat rebuild'dan keyin ko'rinadi; bu servis
// serverdagi deploy skriptni (env: LANDING_DEPLOY_SCRIPT) ishga tushiradi.
// Bir vaqtda faqat bitta build (in-memory qulf), tarix site_builds jadvalida.
// =============================================================================
const REBUILD_TIMEOUT_MS = 10 * 60 * 1000;
const LOG_TAIL_LINES = 50;

@Injectable()
class SiteRebuildService {
  // pm2 single-instance — in-memory qulf yetarli (cluster bo'lsa DB qulfga o'tkaziladi).
  private running = false;

  constructor(private readonly supabase: SupabaseService) {}

  async trigger(userId: string) {
    const script = process.env.LANDING_DEPLOY_SCRIPT;
    if (!script) {
      throw new ServiceUnavailableException(
        'LANDING_DEPLOY_SCRIPT sozlanmagan — rebuild faqat production serverda ishlaydi',
      );
    }
    if (this.running) {
      throw new ConflictException('Build allaqachon ketmoqda — tugashini kuting');
    }
    this.running = true;

    const admin = this.supabase.admin();
    const { data: build, error } = await admin
      .from('site_builds')
      .insert({ status: 'running', triggered_by: userId })
      .select('id, status, started_at')
      .single();
    if (error) {
      this.running = false;
      throw new Error(error.message);
    }
    const buildId = (build as { id: string }).id;

    // Fire-and-forget: jarayon fonda tugaydi, holat site_builds'da yangilanadi.
    void this.run(buildId, script);

    return { id: buildId, status: 'running', started_at: (build as { started_at: string }).started_at };
  }

  private run(buildId: string, script: string): Promise<void> {
    return new Promise((resolve) => {
      const lines: string[] = [];
      const push = (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n')) {
          if (line.trim()) lines.push(line);
        }
        if (lines.length > LOG_TAIL_LINES * 2) lines.splice(0, lines.length - LOG_TAIL_LINES);
      };

      // 'deploy.sh landing' kabi argumentli qiymatni qo'llab-quvvatlaymiz.
      const child = spawn('bash', ['-c', script], { env: process.env });
      child.stdout.on('data', push);
      child.stderr.on('data', push);

      const timer = setTimeout(() => {
        push(Buffer.from(`[rebuild] ${REBUILD_TIMEOUT_MS / 60000} daqiqadan oshdi — to'xtatildi`));
        child.kill('SIGKILL');
      }, REBUILD_TIMEOUT_MS);

      child.on('close', (code) => {
        clearTimeout(timer);
        void this.finish(buildId, code === 0 ? 'success' : 'failed', lines).then(resolve);
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        push(Buffer.from(`[rebuild] ishga tushmadi: ${err.message}`));
        void this.finish(buildId, 'failed', lines).then(resolve);
      });
    });
  }

  private async finish(buildId: string, status: 'success' | 'failed', lines: string[]) {
    this.running = false;
    await this.supabase
      .admin()
      .from('site_builds')
      .update({
        status,
        finished_at: new Date().toISOString(),
        log_tail: lines.slice(-LOG_TAIL_LINES).join('\n'),
      })
      .eq('id', buildId);
  }

  async status() {
    const { data } = await this.supabase
      .admin()
      .from('site_builds')
      .select('id, status, started_at, finished_at, log_tail, triggered_by')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return {
      enabled: !!process.env.LANDING_DEPLOY_SCRIPT,
      last_build: data ?? null,
    };
  }
}

// --- Public controller (no auth) ------------------------------------------
@ApiTags('site-cms')
@Controller({ path: 'site', version: '1' })
class SitePublicController {
  constructor(private readonly svc: SiteCmsService) {}

  @Public()
  @Get('content')
  content(@Query('locale') locale?: string) {
    return this.svc.publicContent(locale ?? 'uz-Latn');
  }
}

// --- Admin controller (super_admin only) ----------------------------------
@ApiTags('admin-site-cms')
@Controller({ path: 'admin/site', version: '1' })
@UseGuards(SuperAdminGuard)
@Throttle({ default: { ttl: 60_000, limit: 300 } })
class SiteAdminController {
  constructor(
    private readonly svc: SiteCmsService,
    private readonly rebuild: SiteRebuildService,
  ) {}

  @Post('rebuild')
  triggerRebuild(@CurrentUser() u: { userId: string | null }) {
    if (!u.userId) throw new ForbiddenException();
    return this.rebuild.trigger(u.userId);
  }

  @Get('rebuild/status')
  rebuildStatus() {
    return this.rebuild.status();
  }

  @Get('entries')
  list() {
    return this.svc.listAll();
  }

  @Post('entries')
  create(@CurrentUser() u: { userId: string | null }, @Body() body: unknown) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.createEntry(u.userId, EntrySchema.parse(body));
  }

  @Post('entries/:id/update')
  update(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.updateEntry(u.userId, id, UpdateEntrySchema.parse(body));
  }

  @Post('entries/:id/publish')
  publish(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { comment?: string },
  ) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.publishEntry(u.userId, id, body?.comment);
  }

  @Post('entries/:id/archive')
  archive(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.archiveEntry(u.userId, id);
  }

  @Get('entries/:id/revisions')
  revisions(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.listRevisions(id);
  }

  @Get('media')
  media() {
    return this.svc.listMedia();
  }

  @Post('media')
  createMedia(@CurrentUser() u: { userId: string | null }, @Body() body: unknown) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.createMedia(u.userId, MediaSchema.parse(body));
  }

  @Post('media/:id/delete')
  deleteMedia(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteMedia(id);
  }
}

@Module({
  controllers: [SitePublicController, SiteAdminController],
  providers: [SiteCmsService, SiteRebuildService, SupabaseService],
})
export class SiteCmsModule {}
