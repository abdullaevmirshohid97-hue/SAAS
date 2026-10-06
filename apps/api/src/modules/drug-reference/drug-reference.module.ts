import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Module,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PharmacyCapability } from '../../common/decorators/pharmacy-workspace.decorator';
import { RequireAnyPerm } from '../../common/decorators/require-perm.decorator';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { SupabaseService } from '../../common/services/supabase.service';
import {
  AdoptSchema,
  ReferenceSearchSchema,
  RegistryActivateSchema,
  RegistryImportSchema,
} from './drug-reference.schemas';
import { DrugReferenceService } from './drug-reference.service';
import { MxikClient } from './mxik-client';

// =============================================================================
// Davlat dori katalogi (MXIK) moduli
// =============================================================================
//   /pharmacy/reference/*        — dorixona (prixod, yangi dori formasi, skaner)
//   /admin/drug-reference/*      — super admin: sinxron, statistika, reestr importi
// =============================================================================

export { DrugReferenceService } from './drug-reference.service';
export type { DrugReferenceHit, ReferenceLookup } from './drug-reference.service';

type U = { clinicId: string | null; userId: string | null };

function need(u: U): { clinicId: string; userId: string } {
  if (!u.clinicId || !u.userId) throw new ForbiddenException();
  return { clinicId: u.clinicId, userId: u.userId };
}

const VIEW = [
  'pharmacy.view',
  'medications.view',
  'medications.create',
  'pharmacy.receive_stock',
] as const;

@ApiTags('pharmacy')
@Controller({ path: 'pharmacy/reference', version: '1' })
class PharmacyReferenceController {
  constructor(private readonly svc: DrugReferenceService) {}

  /** Nom / MNN / shtrix-kod / MXIK bo'yicha — 1 harfdan boshlab. */
  @Get('search')
  @RequireAnyPerm(...VIEW)
  search(@CurrentUser() u: U, @Query() query: Record<string, string>) {
    const { q, kind, limit } = ReferenceSearchSchema.parse(query);
    return this.svc.search(need(u).clinicId, q, kind, limit);
  }

  /** Skaner kodi bo'yicha katalogdan (live=1 — topilmasa MXIK API'dan). */
  @Get('lookup')
  @RequireAnyPerm(...VIEW)
  lookup(@CurrentUser() u: U, @Query('code') code?: string, @Query('live') live?: string) {
    return this.svc.lookupCode(String(code ?? '').slice(0, 300), {
      live: live === '1' || live === 'true',
      clinicId: need(u).clinicId,
    });
  }

  /** Qadoq kodlari (fiskal chek) — yangi dori formasi MXIK tanlaganda. */
  @Get('packages')
  @RequireAnyPerm(...VIEW)
  packages(@Query('mxik') mxik?: string, @Query('sell_by_unit') sellByUnit?: string) {
    const code = String(mxik ?? '');
    if (!/^\d{17}$/.test(code)) throw new BadRequestException('MXIK kodi 17 xonali');
    return this.svc.packagesFor(code, sellByUnit === '1' || sellByUnit === 'true');
  }

  /** Katalogdagi dorini klinika bazasiga qo'shish (takror yaratilmaydi). */
  @Post('adopt')
  @RequireAnyPerm('medications.create', 'pharmacy.receive_stock')
  @PharmacyCapability('receive')
  @Audit({ action: 'pharmacy.reference_adopted', resourceType: 'medications' })
  adopt(@CurrentUser() u: U, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    return this.svc.adopt(clinicId, userId, AdoptSchema.parse(body));
  }
}

@ApiTags('admin-drug-reference')
@Controller('admin/drug-reference')
@UseGuards(SuperAdminGuard)
class AdminDrugReferenceController {
  constructor(private readonly svc: DrugReferenceService) {}

  @Get('stats')
  stats() {
    return this.svc.stats();
  }

  @Get('search')
  search(@Query() query: Record<string, string>) {
    const { q, kind, limit } = ReferenceSearchSchema.parse(query);
    return this.svc.search(null, q, kind, limit);
  }

  @Post('sync')
  sync(@CurrentUser() u: { userId: string | null }) {
    return this.svc.startSync(u.userId ?? null);
  }

  @Post('registry/import')
  registryImport(@Body() body: unknown) {
    const input = RegistryImportSchema.parse(body);
    return this.svc.registryImport(input.import_id, input.rows);
  }

  @Post('registry/activate')
  registryActivate(@CurrentUser() u: { userId: string | null }, @Body() body: unknown) {
    const input = RegistryActivateSchema.parse(body);
    return this.svc.registryActivate(input.import_id, u.userId ?? null, input.file_name);
  }

  @Post('registry/discard')
  registryDiscard(@Body() body: unknown) {
    return this.svc.registryDiscard(RegistryActivateSchema.parse(body).import_id);
  }
}

@Module({
  controllers: [PharmacyReferenceController, AdminDrugReferenceController],
  providers: [DrugReferenceService, MxikClient, SupabaseService],
  exports: [DrugReferenceService],
})
export class DrugReferenceModule {}
