import {
  Body,
  Controller,
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

import { getContext } from '../../common/context/request-context';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  PharmacyAdmin,
  PharmacyWsOpen,
} from '../../common/decorators/pharmacy-workspace.decorator';
import { RequireAnyPerm } from '../../common/decorators/require-perm.decorator';
import { requireOperator } from './pharmacy-ctx';
import { PharmacyFiscalService } from './pharmacy-fiscal.service';
import { PharmacyShiftService } from './pharmacy-shift.service';
import { PharmacyWorkspaceService } from './pharmacy-workspace.service';
import {
  CashMovementSchema,
  CloseShiftSchema,
  DeviceRegisterSchema,
  DeviceUpdateSchema,
  FiscalSettingsSchema,
  OpenShiftSchema,
  OperatorCreateSchema,
  OperatorLoginSchema,
  OperatorSetupSchema,
  OperatorUpdateSchema,
} from './pharmacy.schemas';

type U = { clinicId: string | null; userId: string | null };
function need(u: U): { clinicId: string; userId: string } {
  if (!u.clinicId || !u.userId) throw new ForbiddenException();
  return { clinicId: u.clinicId, userId: u.userId };
}

// =============================================================================
// /pharmacy-ws — alohida "Dorixona" kirishi: holat, qurilma, PIN operatorlar
// =============================================================================
// Operatorlar/qurilmalarni boshqarish: dorixona akkauntida ADMIN PIN bilan,
// klinika tomonida — klinika egasi/admini (Sozlamalar → Dorixona).
@ApiTags('pharmacy-workspace')
@Controller({ path: 'pharmacy-ws', version: '1' })
export class PharmacyWorkspaceController {
  constructor(private readonly svc: PharmacyWorkspaceService) {}

  /** Holat: obuna, qurilma, operator sessiyasi. Obuna faol bo'lmasa ham ochiq. */
  @Get('status')
  @PharmacyWsOpen('no-device')
  status(@CurrentUser() u: U) {
    return this.svc.status(need(u).clinicId);
  }

  @Post('devices/register')
  @PharmacyWsOpen('no-device')
  @Audit({ action: 'pharmacy.device_registered', resourceType: 'pharmacy_devices' })
  registerDevice(@CurrentUser() u: U, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    const c = getContext();
    if (c.workspace !== 'pharmacy') {
      throw new ForbiddenException('Qurilma faqat dorixona akkauntida ro‘yxatga olinadi');
    }
    return this.svc.registerDevice(clinicId, userId, DeviceRegisterSchema.parse(body), {
      userAgent: c.userAgent,
      ip: c.ip,
    });
  }

  @Get('devices')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @PharmacyAdmin()
  listDevices(@CurrentUser() u: U) {
    return this.svc.listDevices(need(u).clinicId);
  }

  @Patch('devices/:id')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @PharmacyAdmin()
  updateDevice(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.svc.updateDevice(need(u).clinicId, id, DeviceUpdateSchema.parse(body));
  }

  @Post('devices/:id/revoke')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @PharmacyAdmin()
  @Audit({ action: 'pharmacy.device_revoked', resourceType: 'pharmacy_devices' })
  revokeDevice(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    const { clinicId, userId } = need(u);
    return this.svc.revokeDevice(clinicId, userId, id);
  }

  @Post('devices/:id/restore')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @PharmacyAdmin()
  restoreDevice(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.restoreDevice(need(u).clinicId, id);
  }

  // ---- PIN kirish ----------------------------------------------------------
  @Get('operators/login-list')
  @PharmacyWsOpen('no-operator')
  loginList(@CurrentUser() u: U) {
    return this.svc.loginList(need(u).clinicId);
  }

  @Post('operators/setup')
  @PharmacyWsOpen('no-operator')
  @Audit({ action: 'pharmacy.operator_setup', resourceType: 'pharmacy_operators' })
  setup(@CurrentUser() u: U, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    const deviceId = getContext().pharmacy?.deviceId;
    if (!deviceId) throw new ForbiddenException('Avval kompyuterni ro‘yxatdan o‘tkazing');
    return this.svc.setup(clinicId, userId, deviceId, OperatorSetupSchema.parse(body));
  }

  @Post('operators/login')
  @PharmacyWsOpen('no-operator')
  login(@CurrentUser() u: U, @Body() body: unknown) {
    const { clinicId } = need(u);
    const deviceId = getContext().pharmacy?.deviceId;
    if (!deviceId) throw new ForbiddenException('Avval kompyuterni ro‘yxatdan o‘tkazing');
    return this.svc.login(clinicId, deviceId, OperatorLoginSchema.parse(body));
  }

  @Post('operators/logout')
  @PharmacyWsOpen('no-operator')
  logout(@CurrentUser() u: U) {
    return this.svc.logout(need(u).clinicId, getContext().pharmacyOperatorToken ?? null);
  }

  @Get('me')
  me() {
    const ws = requireOperator();
    return { operator: ws };
  }

  // ---- Operatorlar boshqaruvi ---------------------------------------------
  @Get('operators')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @PharmacyAdmin()
  listOperators(@CurrentUser() u: U) {
    return this.svc.listOperators(need(u).clinicId);
  }

  @Post('operators')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @PharmacyAdmin()
  @Audit({ action: 'pharmacy.operator_created', resourceType: 'pharmacy_operators' })
  createOperator(@CurrentUser() u: U, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    return this.svc.createOperator(clinicId, userId, OperatorCreateSchema.parse(body));
  }

  @Patch('operators/:id')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @PharmacyAdmin()
  @Audit({ action: 'pharmacy.operator_updated', resourceType: 'pharmacy_operators' })
  updateOperator(
    @CurrentUser() u: U,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { clinicId, userId } = need(u);
    return this.svc.updateOperator(clinicId, userId, id, OperatorUpdateSchema.parse(body));
  }
}

// =============================================================================
// /pharmacy/shifts — dorixona kassasi (har kassaga alohida smena)
// =============================================================================
@ApiTags('pharmacy-shifts')
@Controller({ path: 'pharmacy/shifts', version: '1' })
export class PharmacyShiftController {
  constructor(private readonly svc: PharmacyShiftService) {}

  @Get('current')
  @RequireAnyPerm('pharmacy.view', 'pharmacy.dispense')
  current(@CurrentUser() u: U, @Query('register_no') registerNo?: string) {
    return this.svc.current(need(u).clinicId, registerNo ? Number(registerNo) : undefined);
  }

  @Get('settings')
  @RequireAnyPerm('pharmacy.view', 'pharmacy.dispense')
  settings(@CurrentUser() u: U) {
    return this.svc.getSettings(need(u).clinicId);
  }

  /** Klinika ichidagi dorixonada smena majburiyligi (egasi/admini). */
  @Put('settings')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @PharmacyAdmin()
  saveSettings(@CurrentUser() u: U, @Body() body: unknown) {
    const { kassa_enabled } = z.object({ kassa_enabled: z.boolean() }).parse(body);
    return this.svc.setKassaEnabled(need(u).clinicId, kassa_enabled);
  }

  @Post('open')
  @RequireAnyPerm('pharmacy.dispense', 'cashier.close_shift')
  @Audit({ action: 'pharmacy.shift_opened', resourceType: 'pharmacy_shifts' })
  open(@CurrentUser() u: U, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    return this.svc.open(clinicId, userId, OpenShiftSchema.parse(body));
  }

  @Post(':id/close')
  @RequireAnyPerm('pharmacy.dispense', 'cashier.close_shift')
  @Audit({ action: 'pharmacy.shift_closed', resourceType: 'pharmacy_shifts' })
  close(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    return this.svc.close(clinicId, userId, id, CloseShiftSchema.parse(body));
  }

  @Get()
  @RequireAnyPerm('pharmacy.view', 'pharmacy.dispense')
  list(
    @CurrentUser() u: U,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('register_no') registerNo?: string,
  ) {
    return this.svc.list(need(u).clinicId, {
      from,
      to,
      register_no: registerNo ? Number(registerNo) : undefined,
    });
  }

  @Get(':id/report')
  @RequireAnyPerm('pharmacy.view', 'pharmacy.dispense')
  report(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.report(need(u).clinicId, id);
  }

  @Get(':id/movements')
  @RequireAnyPerm('pharmacy.view', 'pharmacy.dispense')
  movements(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.listMovements(need(u).clinicId, id);
  }

  @Post('movements')
  @RequireAnyPerm('pharmacy.dispense', 'cashier.accept_payment')
  @Audit({ action: 'pharmacy.cash_movement', resourceType: 'pharmacy_cash_movements' })
  addMovement(@CurrentUser() u: U, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    return this.svc.addMovement(clinicId, userId, CashMovementSchema.parse(body));
  }
}

// =============================================================================
// /pharmacy/fiscal — fiskal chek sozlamalari va navbati
// =============================================================================
@ApiTags('pharmacy-fiscal')
@Controller({ path: 'pharmacy/fiscal', version: '1' })
export class PharmacyFiscalController {
  constructor(private readonly svc: PharmacyFiscalService) {}

  @Get('settings')
  @RequireAnyPerm('pharmacy.view')
  settings(@CurrentUser() u: U) {
    return this.svc.publicSettings(need(u).clinicId);
  }

  @Put('settings')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @PharmacyAdmin()
  @Audit({ action: 'pharmacy.fiscal_settings', resourceType: 'pharmacy_fiscal_settings' })
  save(@CurrentUser() u: U, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    return this.svc.saveSettings(clinicId, userId, FiscalSettingsSchema.parse(body));
  }

  @Get('receipts')
  @RequireAnyPerm('pharmacy.view')
  list(@CurrentUser() u: U, @Query('status') status?: string) {
    const s =
      status && ['pending', 'sent', 'failed', 'skipped'].includes(status) ? status : undefined;
    return this.svc.list(need(u).clinicId, s);
  }

  @Post('receipts/:id/retry')
  @RequireAnyPerm('pharmacy.dispense')
  retry(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.retry(need(u).clinicId, id);
  }

  /** Eski (fiskalsiz) sotuvga qo'lda fiskal chek. */
  @Post('sales/:saleId/send')
  @RequireAnyPerm('pharmacy.dispense')
  @PharmacyAdmin()
  sendSale(@CurrentUser() u: U, @Param('saleId', ParseUUIDPipe) saleId: string) {
    return this.svc.enqueueSale(need(u).clinicId, saleId, 6000);
  }
}
