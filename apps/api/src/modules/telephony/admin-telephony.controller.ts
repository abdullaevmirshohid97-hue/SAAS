import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { SuperAdminGuard } from '../../common/guards/super-admin.guard';

import { PbxService } from './pbx.service';

// =============================================================================
// Super admin — klinikaning bulutli ATS holati (faqat ko'rish)
// =============================================================================
// Trunk ulanganmi, ichki raqamlar va qurilmalar onlaynmi, oy davomida nechta
// qo'ng'iroq / o'tkazib yuborilgan. Parollar QAYTARILMAYDI.
// =============================================================================

@ApiTags('admin-telephony')
@Controller('admin')
@UseGuards(SuperAdminGuard)
export class AdminTelephonyController {
  constructor(private readonly pbx: PbxService) {}

  @Get('tenants/:id/telephony')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.pbx.adminOverview(id);
  }
}
