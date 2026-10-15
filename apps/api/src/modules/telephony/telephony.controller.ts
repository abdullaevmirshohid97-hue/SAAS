import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { addDays, localMidnightUtcMs } from '@clary/utils';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePerm } from '../../common/decorators/require-perm.decorator';

import { PbxService } from './pbx.service';

// =============================================================================
// Bulutli ATS — klinika xodimlari uchun endpointlar
// =============================================================================
//   Sozlamalar → IP-telefoniya: trunk (Uztelecom login/parol), ichki raqamlar
//   Softfon (har bir xodim): /telephony/me — WebRTC akkaunt, /directory, /lookup
//   Qo'ng'iroqlar sahifasi: /telephony/calls
// =============================================================================

type U = { clinicId: string | null; userId: string | null };

// SIP login/parol Asterisk sozlama fayliga yoziladi — boshqaruv belgilari va
// bo'shliqlar taqiqlanadi (fayl in'ektsiyasining oldi olinadi)
const SipToken = z
  .string()
  .max(120)
  .regex(/^[\x21-\x7e]*$/, "Faqat lotin harflari, raqamlar va belgilar (bo'shliqsiz)");

const TenantSchema = z.object({
  enabled: z.boolean(),
  trunk_host: z.string().max(253).nullable(),
  trunk_port: z.number().int().min(1).max(65535),
  trunk_transport: z.enum(['udp', 'tcp']),
  trunk_username: SipToken.nullable(),
  trunk_password: SipToken.nullish(),
  trunk_from_domain: z.string().max(253).nullable(),
  did: z.string().max(30).nullable(),
  dial_format: z.enum(['e164', 'digits12', 'local9']),
  ring_timeout_sec: z.number().int().min(5).max(120),
  after_hours: z.enum(['ring', 'ai']),
  no_answer: z.enum(['voicemail', 'ai', 'message']).optional(),
  max_outbound: z.number().int().min(1).max(50),
});

const Label = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[^"<>;\\\r\n\t]+$/, 'Nomda " < > ; \\ belgilari bo‘lmasin');

const ExtensionSchema = z.object({
  label: Label,
  ext: z
    .string()
    .regex(/^[2-8][0-9]{2}$/, 'Ichki raqam 201–899 oralig‘ida')
    .nullish(),
  profile_id: z.string().uuid().nullish(),
  in_ring_group: z.boolean().optional(),
  can_call_out: z.boolean().optional(),
});
const ExtensionPatchSchema = z.object({
  label: Label.optional(),
  profile_id: z.string().uuid().nullish(),
  in_ring_group: z.boolean().optional(),
  can_call_out: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

function clinicOf(u: U): string {
  if (!u.clinicId) throw new ForbiddenException();
  return u.clinicId;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

@ApiTags('telephony')
@Controller({ path: 'telephony', version: '1' })
export class TelephonyController {
  constructor(private readonly pbx: PbxService) {}

  // ---------------------------------------------------------------- sozlamalar
  @Get('settings')
  @RequirePerm('settings.view')
  async settings(@CurrentUser() u: U) {
    const clinicId = clinicOf(u);
    const [tenant, extensions, staff] = await Promise.all([
      this.pbx.getTenant(clinicId),
      this.pbx.listExtensions(clinicId, false),
      this.pbx.staffOptions(clinicId),
    ]);
    return {
      server: this.pbx.serverInfo(),
      tenant: this.pbx.publicTenant(tenant),
      extensions,
      staff,
    };
  }

  @Put('settings')
  @RequirePerm('settings.manage_integrations')
  @Audit({ action: 'telephony.settings_updated', resourceType: 'pbx_tenants' })
  saveSettings(@CurrentUser() u: U, @Body() body: unknown) {
    return this.pbx.saveTenant(clinicOf(u), u.userId, TenantSchema.parse(body));
  }

  // ---------------------------------------------------------------- ichki raqamlar
  @Post('extensions')
  @RequirePerm('settings.manage_integrations')
  @Audit({ action: 'telephony.extension_created', resourceType: 'pbx_extensions' })
  createExtension(@CurrentUser() u: U, @Body() body: unknown) {
    return this.pbx.createExtension(clinicOf(u), ExtensionSchema.parse(body));
  }

  @Patch('extensions/:id')
  @RequirePerm('settings.manage_integrations')
  @Audit({ action: 'telephony.extension_updated', resourceType: 'pbx_extensions' })
  updateExtension(
    @CurrentUser() u: U,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.pbx.updateExtension(clinicOf(u), id, ExtensionPatchSchema.parse(body));
  }

  @Post('extensions/:id/reset-password')
  @RequirePerm('settings.manage_integrations')
  @Audit({ action: 'telephony.extension_password_reset', resourceType: 'pbx_extensions' })
  resetPassword(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    return this.pbx.resetPassword(clinicOf(u), id);
  }

  @Delete('extensions/:id')
  @RequirePerm('settings.manage_integrations')
  @Audit({ action: 'telephony.extension_deleted', resourceType: 'pbx_extensions' })
  deleteExtension(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    return this.pbx.deleteExtension(clinicOf(u), id);
  }

  /** Stol IP telefonini sozlash uchun login/parol (faqat boshqaruvchi ko'radi). */
  @Get('extensions/:id/credentials')
  @RequirePerm('settings.manage_integrations')
  @Audit({ action: 'telephony.extension_credentials_viewed', resourceType: 'pbx_extensions' })
  async credentials(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    const clinicId = clinicOf(u);
    const list = await this.pbx.listExtensions(clinicId, true);
    const ext = list.find((e) => e.id === id);
    if (!ext) throw new BadRequestException('Ichki raqam topilmadi');
    const server = this.pbx.serverInfo();
    return {
      ext: ext.ext,
      label: ext.label,
      server: server.sip_domain,
      port: server.sip_port,
      transport: 'UDP',
      username: ext.phone_username,
      password: (ext as { phone_password?: string }).phone_password ?? null,
      realm: 'clary',
    };
  }

  // ---------------------------------------------------------------- softfon
  @Get('me')
  me(@CurrentUser() u: U) {
    if (!u.userId) throw new ForbiddenException();
    return this.pbx.me(clinicOf(u), u.userId);
  }

  @Get('directory')
  directory(@CurrentUser() u: U) {
    return this.pbx.directory(clinicOf(u));
  }

  @Get('lookup')
  @RequirePerm('patients.view')
  lookup(@CurrentUser() u: U, @Query('phone') phone?: string) {
    if (!phone || phone.length > 40) throw new BadRequestException('phone kerak');
    return this.pbx.lookup(clinicOf(u), phone);
  }

  // ---------------------------------------------------------------- jurnal
  @Get('calls')
  @RequirePerm('appointments.view')
  calls(
    @CurrentUser() u: U,
    @Query('filter') filter?: string,
    @Query('page') page?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.pbx.listCalls(clinicOf(u), {
      filter: filter && ['all', 'missed', 'in', 'out'].includes(filter) ? filter : 'all',
      page: Math.min(Math.max(Number(page) || 1, 1), 1000),
      from: from && DAY.test(from) ? new Date(localMidnightUtcMs(from)).toISOString() : undefined,
      to:
        to && DAY.test(to) ? new Date(localMidnightUtcMs(addDays(to, 1))).toISOString() : undefined,
    });
  }

  @Get('calls/:id/recording')
  @RequirePerm('appointments.view')
  recording(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    return this.pbx.callRecordingUrl(clinicOf(u), id);
  }

  @Post('calls/:id/callback-done')
  @RequirePerm('appointments.view')
  @Audit({ action: 'telephony.callback_done', resourceType: 'pbx_calls' })
  callbackDone(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    return this.pbx.callbackDone(clinicOf(u), id, u.userId);
  }
}
