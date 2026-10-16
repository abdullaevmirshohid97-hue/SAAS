import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { NetworkAccessService, type CompanyUser } from './network-access.service';
import {
  CancelInput,
  CashSendInput,
  CatalogPushInput,
  MergeInput,
  NetworkOpsService,
  ReferralInput,
  SettingsPushInput,
  StockSendInput,
} from './network-ops.service';
import {
  BranchPatch,
  MemberInput,
  MemberPatch,
  NetworkService,
  NetworkSettingsPatch,
} from './network.service';

const SwitchInput = z.object({ clinic_id: z.string().uuid() });

// =============================================================================
// /company — filial tarmog'i (kompaniya = tarmoq, klinika = filial).
// Huquqlar servislarda: tarmoq markazi faqat rahbariyatga (company_members),
// filiallararo transfer/yo'llanma esa filial xodimlariga ham ochiq.
// =============================================================================
@ApiTags('company')
@Controller({ path: 'company', version: '1' })
export class CompanyController {
  constructor(
    private readonly access: NetworkAccessService,
    private readonly network: NetworkService,
    private readonly ops: NetworkOpsService,
  ) {}

  // ── Faza 2: filial almashtirish ─────────────────────────────────────────────
  @Get('access')
  async myAccess(@CurrentUser() u: CompanyUser) {
    if (!u.userId) throw new ForbiddenException();
    const branches = await this.access.myBranches(u.userId);
    return { active_clinic_id: u.clinicId, branches };
  }

  @Post('switch')
  switchBranch(@CurrentUser() u: CompanyUser, @Body() body: unknown) {
    if (!u.userId) throw new ForbiddenException();
    return this.access.switchBranch(u.userId, SwitchInput.parse(body).clinic_id);
  }

  // ── Faza 3: tarmoq markazi ──────────────────────────────────────────────────
  @Get('my')
  my(@CurrentUser() u: CompanyUser) {
    return this.network.my(u);
  }

  @Get('consolidated')
  consolidated(
    @CurrentUser() u: CompanyUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.network.consolidated(u, from, to);
  }

  @Get('live')
  live(@CurrentUser() u: CompanyUser, @Query('day') day?: string) {
    return this.network.live(u, day);
  }

  @Get('compare')
  compare(@CurrentUser() u: CompanyUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.network.compare(u, from, to);
  }

  @Get('staff')
  staff(@CurrentUser() u: CompanyUser) {
    return this.network.staff(u);
  }

  @Get('audit')
  audit(@CurrentUser() u: CompanyUser, @Query('limit') limit?: string) {
    return this.network.auditLog(u, limit ? Number(limit) : 100);
  }

  @Get('members')
  members(@CurrentUser() u: CompanyUser) {
    return this.network.members(u);
  }

  @Post('members')
  addMember(@CurrentUser() u: CompanyUser, @Body() body: unknown) {
    return this.network.addMember(u, MemberInput.parse(body));
  }

  @Patch('members/:id')
  updateMember(
    @CurrentUser() u: CompanyUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.network.updateMember(u, id, MemberPatch.parse(body));
  }

  @Delete('members/:id')
  removeMember(@CurrentUser() u: CompanyUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.network.removeMember(u, id);
  }

  @Patch('settings')
  updateSettings(@CurrentUser() u: CompanyUser, @Body() body: unknown) {
    return this.network.updateSettings(u, NetworkSettingsPatch.parse(body));
  }

  @Patch('branches/:id')
  updateBranch(
    @CurrentUser() u: CompanyUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.network.updateBranch(u, id, BranchPatch.parse(body));
  }

  // ── Faza 4: HQ'dan markaziy boshqaruv ──────────────────────────────────────
  @Post('catalog/push')
  pushCatalog(@CurrentUser() u: CompanyUser, @Body() body: unknown) {
    return this.ops.pushCatalog(u, CatalogPushInput.parse(body));
  }

  @Post('settings/push')
  pushSettings(@CurrentUser() u: CompanyUser, @Body() body: unknown) {
    return this.ops.pushSettings(u, SettingsPushInput.parse(body));
  }

  // ── Faza 5: filiallararo amallar ───────────────────────────────────────────
  @Get('branches/:id/services')
  branchServices(@CurrentUser() u: CompanyUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ops.branchServices(u, id);
  }

  @Get('referrals')
  referrals(@CurrentUser() u: CompanyUser) {
    return this.ops.listReferrals(u);
  }

  @Post('referrals')
  @Roles('clinic_owner', 'clinic_admin', 'doctor', 'receptionist', 'nurse')
  createReferral(@CurrentUser() u: CompanyUser, @Body() body: unknown) {
    return this.ops.createReferral(u, ReferralInput.parse(body));
  }

  @Get('transfers/stock')
  @Roles('clinic_owner', 'clinic_admin', 'pharmacist')
  stockTransfers(@CurrentUser() u: CompanyUser) {
    return this.ops.stockTransfers(u);
  }

  @Get('transfers/stock/:id')
  @Roles('clinic_owner', 'clinic_admin', 'pharmacist')
  stockTransfer(@CurrentUser() u: CompanyUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ops.stockTransfer(u, id);
  }

  @Post('transfers/stock')
  @Roles('clinic_owner', 'clinic_admin', 'pharmacist')
  sendStock(@CurrentUser() u: CompanyUser, @Body() body: unknown) {
    return this.ops.sendStock(u, StockSendInput.parse(body));
  }

  @Post('transfers/stock/:id/receive')
  @Roles('clinic_owner', 'clinic_admin', 'pharmacist')
  receiveStock(@CurrentUser() u: CompanyUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ops.receiveStock(u, id);
  }

  @Post('transfers/stock/:id/cancel')
  @Roles('clinic_owner', 'clinic_admin', 'pharmacist')
  cancelStock(
    @CurrentUser() u: CompanyUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.ops.cancelStock(u, id, CancelInput.parse(body).reason);
  }

  @Get('transfers/cash')
  @Roles('clinic_owner', 'clinic_admin', 'cashier')
  cashTransfers(@CurrentUser() u: CompanyUser) {
    return this.ops.cashTransfers(u);
  }

  @Post('transfers/cash')
  @Roles('clinic_owner', 'clinic_admin', 'cashier')
  sendCash(@CurrentUser() u: CompanyUser, @Body() body: unknown) {
    return this.ops.sendCash(u, CashSendInput.parse(body));
  }

  @Post('transfers/cash/:id/receive')
  @Roles('clinic_owner', 'clinic_admin', 'cashier')
  receiveCash(@CurrentUser() u: CompanyUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ops.receiveCash(u, id);
  }

  @Post('transfers/cash/:id/cancel')
  @Roles('clinic_owner', 'clinic_admin', 'cashier')
  cancelCash(
    @CurrentUser() u: CompanyUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.ops.cancelCash(u, id, CancelInput.parse(body).reason);
  }

  @Get('patients/duplicates')
  duplicates(@CurrentUser() u: CompanyUser) {
    return this.ops.duplicates(u);
  }

  @Post('patients/merge')
  @Roles('clinic_owner', 'clinic_admin')
  merge(@CurrentUser() u: CompanyUser, @Body() body: unknown) {
    return this.ops.merge(u, MergeInput.parse(body));
  }
}
