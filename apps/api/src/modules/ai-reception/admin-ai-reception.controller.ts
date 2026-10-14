import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';

import { AiReceptionSettingsService } from './settings.service';

// =============================================================================
// Super admin — AI qabulxona premium ruxsati va oylik chegara
// =============================================================================
// AI rejimi pullik (LLM + STT + TTS xarajati) — klinika o'zi yoqa olmaydi,
// faqat shu yerdan ruxsat beriladi. Ovozli xabar rejimi va Telegram tugmali
// navbat hammaga bepul.
// =============================================================================

const AdminSchema = z.object({
  ai_allowed: z.boolean().optional(),
  monthly_call_limit: z.number().int().min(0).max(100_000).optional(),
});

@ApiTags('admin-ai-reception')
@Controller('admin')
@UseGuards(SuperAdminGuard)
export class AdminAiReceptionController {
  constructor(private readonly settings: AiReceptionSettingsService) {}

  @Get('tenants/:id/ai-reception')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const [settings, usage, lines] = await Promise.all([
      this.settings.get(id),
      this.settings.monthlyUsage(id),
      this.settings.listLines(id),
    ]);
    return { settings, usage, lines };
  }

  @Put('tenants/:id/ai-reception')
  set(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.settings.adminSet(id, u.userId, AdminSchema.parse(body));
  }
}
