import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  DynamicModule,
  ForbiddenException,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Type,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { ZodSchema } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { Roles, type Role } from '../../common/decorators/roles.decorator';
import { getContext } from '../../common/context/request-context';
import { SupabaseService } from '../../common/services/supabase.service';

/**
 * Generic catalog factory. One call creates a full CRUD + bulk + history
 * controller + service for any catalog table that follows the standard pattern
 * (clinic_id, is_archived, sort_order, version, created_by, updated_by, timestamps).
 *
 * Usage:
 *   createCatalogModule({ table: 'services', createSchema, updateSchema, roles: ['clinic_admin'] })
 */
export interface CatalogModuleOptions<TCreate, TUpdate> {
  table: string;
  route: string; // e.g. 'services'
  createSchema: ZodSchema<TCreate>;
  updateSchema: ZodSchema<TUpdate>;
  listRoles?: Role[];
  mutateRoles?: Role[];
  softDelete?: boolean;
  softDeleteField?: string; // default 'is_archived'
}

export function createCatalogModule<TCreate, TUpdate>(
  options: CatalogModuleOptions<TCreate, TUpdate>,
): DynamicModule {
  const softDeleteField = options.softDeleteField ?? 'is_archived';
  const mutateRoles = options.mutateRoles ?? ['clinic_admin', 'clinic_owner', 'super_admin'];

  @Injectable()
  class CatalogService {
    constructor(public readonly supabase: SupabaseService) {}

    private client() {
      // Use admin client because RLS is already applied and NestJS guards
      // already enforced tenancy. We pass clinic_id explicitly.
      return this.supabase.admin();
    }

    async list(params: {
      clinicId: string;
      page: number;
      pageSize: number;
      q?: string;
      includeArchived?: boolean;
    }) {
      const { clinicId, page, pageSize, q, includeArchived } = params;
      const from = (page - 1) * pageSize;
      let query = this.client()
        .from(options.table)
        .select('*', { count: 'exact' })
        .eq('clinic_id', clinicId)
        .range(from, from + pageSize - 1)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });

      if (!includeArchived) query = query.eq(softDeleteField, false);
      if (q) query = query.ilike('name', `%${q}%`);
      const { data, error, count } = await query;
      if (error) throw new NotFoundException(error.message);
      return {
        items: data ?? [],
        total: count ?? 0,
        page,
        pageSize,
      };
    }

    async getOne(clinicId: string, id: string) {
      const { data, error } = await this.client()
        .from(options.table)
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('id', id)
        .single();
      if (error || !data) throw new NotFoundException(`${options.table} not found`);
      return data;
    }

    async create(clinicId: string, userId: string, payload: TCreate) {
      await this.setActorContext();
      const { data, error } = await this.client()
        .from(options.table)
        .insert({ ...payload, clinic_id: clinicId, created_by: userId, updated_by: userId })
        .select()
        .single();
      if (error) throw new ForbiddenException(error.message);
      return data;
    }

    async update(clinicId: string, id: string, userId: string, payload: TUpdate, expectedVersion?: number) {
      await this.setActorContext();
      let q = this.client()
        .from(options.table)
        .update({ ...payload, updated_by: userId })
        .eq('clinic_id', clinicId)
        .eq('id', id);
      if (typeof expectedVersion === 'number') q = q.eq('version', expectedVersion);
      const { data, error } = await q.select().single();
      if (error) throw new NotFoundException(error.message);
      return data;
    }

    async archive(clinicId: string, id: string, userId: string, reason?: string) {
      await this.setActorContext();
      const patch: Record<string, unknown> = {
        [softDeleteField]: true,
        archived_at: new Date().toISOString(),
        archived_by: userId,
        updated_by: userId,
      };
      if (reason) patch['archive_reason'] = reason;
      const { data, error } = await this.client()
        .from(options.table)
        .update(patch)
        .eq('clinic_id', clinicId)
        .eq('id', id)
        .select()
        .single();
      if (error) throw new NotFoundException(error.message);
      return data;
    }

    async restore(clinicId: string, id: string, userId: string) {
      await this.setActorContext();
      const { data, error } = await this.client()
        .from(options.table)
        .update({
          [softDeleteField]: false,
          archived_at: null,
          archived_by: null,
          updated_by: userId,
        })
        .eq('clinic_id', clinicId)
        .eq('id', id)
        .select()
        .single();
      if (error) throw new NotFoundException(error.message);
      return data;
    }

    async history(clinicId: string, id: string) {
      const { data, error } = await this.client()
        .from('settings_audit_log')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('table_name', options.table)
        .eq('record_id', id)
        .order('sequence', { ascending: false });
      if (error) throw new NotFoundException(error.message);
      return data ?? [];
    }

    async bulk(clinicId: string, userId: string, op: 'archive' | 'restore', ids: string[]) {
      await this.setActorContext();
      const patch: Record<string, unknown> =
        op === 'archive'
          ? { [softDeleteField]: true, archived_at: new Date().toISOString(), archived_by: userId, updated_by: userId }
          : { [softDeleteField]: false, archived_at: null, archived_by: null, updated_by: userId };
      const { count, error } = await this.client()
        .from(options.table)
        .update(patch)
        .eq('clinic_id', clinicId)
        .in('id', ids);
      if (error) throw new ForbiddenException(error.message);
      return { affected: count };
    }

    private async setActorContext() {
      const ctx = getContext();
      if (!ctx.userId || !ctx.clinicId) return;
      await this.client().rpc('set_actor_context' as never, {
        p_actor_id: ctx.userId,
        p_actor_role: ctx.role,
        p_actor_ip: ctx.ip,
        p_actor_ua: ctx.userAgent,
      } as never);
    }
  }

  @ApiTags('catalog')
  @Controller(`catalog/${options.route}`)
  class CatalogController {
    constructor(private readonly svc: CatalogService) {}

    @Get()
    async list(
      @CurrentUser() user: { clinicId: string | null },
      @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
      @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize: number,
      @Query('q') q?: string,
      @Query('includeArchived') includeArchived?: string,
    ) {
      if (!user.clinicId) throw new ForbiddenException();
      return this.svc.list({
        clinicId: user.clinicId,
        page,
        pageSize,
        q,
        includeArchived: includeArchived === 'true',
      });
    }

    @Get(':id')
    async getOne(
      @CurrentUser() user: { clinicId: string | null },
      @Param('id', ParseUUIDPipe) id: string,
    ) {
      if (!user.clinicId) throw new ForbiddenException();
      return this.svc.getOne(user.clinicId, id);
    }

    @Post()
    @Roles(...mutateRoles)
    @Audit({ action: `${options.route}.created`, resourceType: options.table })
    async create(
      @CurrentUser() user: { clinicId: string | null; userId: string | null },
      @Body() body: unknown,
    ) {
      if (!user.clinicId || !user.userId) throw new ForbiddenException();
      const payload = options.createSchema.parse(body);
      return this.svc.create(user.clinicId, user.userId, payload);
    }

    @Patch(':id')
    @Roles(...mutateRoles)
    @Audit({ action: `${options.route}.updated`, resourceType: options.table })
    async update(
      @CurrentUser() user: { clinicId: string | null; userId: string | null },
      @Param('id', ParseUUIDPipe) id: string,
      @Body() body: unknown,
      @Query('version', new DefaultValuePipe(0), ParseIntPipe) version: number,
    ) {
      if (!user.clinicId || !user.userId) throw new ForbiddenException();
      const payload = options.updateSchema.parse(body);
      return this.svc.update(user.clinicId, id, user.userId, payload, version > 0 ? version : undefined);
    }

    @Delete(':id')
    @Roles(...mutateRoles)
    @Audit({ action: `${options.route}.archived`, resourceType: options.table })
    async archive(
      @CurrentUser() user: { clinicId: string | null; userId: string | null },
      @Param('id', ParseUUIDPipe) id: string,
      @Query('reason') reason?: string,
    ) {
      if (!user.clinicId || !user.userId) throw new ForbiddenException();
      return this.svc.archive(user.clinicId, id, user.userId, reason);
    }

    @Post(':id/restore')
    @Roles(...mutateRoles)
    @Audit({ action: `${options.route}.restored`, resourceType: options.table })
    async restore(
      @CurrentUser() user: { clinicId: string | null; userId: string | null },
      @Param('id', ParseUUIDPipe) id: string,
    ) {
      if (!user.clinicId || !user.userId) throw new ForbiddenException();
      return this.svc.restore(user.clinicId, id, user.userId);
    }

    @Get(':id/history')
    async history(
      @CurrentUser() user: { clinicId: string | null },
      @Param('id', ParseUUIDPipe) id: string,
    ) {
      if (!user.clinicId) throw new ForbiddenException();
      return this.svc.history(user.clinicId, id);
    }

    @Post('bulk')
    @Roles(...mutateRoles)
    @Audit({ action: `${options.route}.bulk`, resourceType: options.table })
    async bulk(
      @CurrentUser() user: { clinicId: string | null; userId: string | null },
      @Body() body: { op: 'archive' | 'restore'; ids: string[] },
    ) {
      if (!user.clinicId || !user.userId) throw new ForbiddenException();
      return this.svc.bulk(user.clinicId, user.userId, body.op, body.ids);
    }
  }

  return {
    module: class CatalogDynamicModule {} as Type<unknown>,
    controllers: [CatalogController],
    providers: [CatalogService, SupabaseService],
    exports: [CatalogService],
  };
}
