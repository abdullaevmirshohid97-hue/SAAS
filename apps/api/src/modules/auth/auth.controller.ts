import { Body, Controller, ForbiddenException, Get, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { AllowWithoutClinic } from '../../common/decorators/allow-without-clinic.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

import { AuthService } from './auth.service';

const ReceiptSettingsSchema = z.object({
  paper_width: z.enum(['58mm', '80mm']).optional(),
  font_family: z.enum(['monospace', 'sans-serif', 'serif']).optional(),
  font_size: z.number().int().min(8).max(24).optional(),
  font_weight: z.enum(['normal', 'bold']).optional(),
  brand_name: z.string().max(120).nullable().optional(),
  slogan: z.string().max(200).nullable().optional(),
  qr_text: z.string().max(500).nullable().optional(),
  qr_enabled: z.boolean().optional(),
  show_transaction_id: z.boolean().optional(),
  footer_note: z.string().max(200).nullable().optional(),
});

const OnboardingSchema = z.object({
  clinicName: z.string().min(2),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(3),
  country: z.string().default('UZ'),
  region: z.string().optional(),
  city: z.string().optional(),
  timezone: z.string().default('Asia/Tashkent'),
  defaultLocale: z.string().default('uz-Latn'),
  organizationType: z.enum(['clinic', 'hospital', 'diagnostic_center', 'dental', 'laboratory', 'pharmacy']),
  staffCountBucket: z.string().optional(),
  logoUrl: z.string().url().optional(),
  primaryColor: z.string().optional(),
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly svc: AuthService) {}

  @Get('me')
  me(@CurrentUser() user: { userId: string | null; clinicId: string | null; role: string }) {
    return this.svc.me(user);
  }

  @Get('onboarding-status')
  onboardingStatus(@CurrentUser() user: { clinicId: string | null }) {
    return this.svc.onboardingStatus(user.clinicId);
  }

  @AllowWithoutClinic()
  @Post('onboarding')
  onboarding(
    @CurrentUser() user: { userId: string | null },
    @Body() body: unknown,
  ) {
    const data = OnboardingSchema.parse(body);
    return this.svc.completeOnboarding(user.userId!, data);
  }

  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 20 } })
  @Post('check-slug')
  checkSlug(@Body() body: { slug: string }) {
    return this.svc.slugAvailable(body.slug);
  }

  // Klinikaning chek printer sozlamalari — faqat admin/owner tahrirlaydi.
  @Patch('clinic/receipt-settings')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  updateReceiptSettings(
    @CurrentUser() u: { clinicId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.updateReceiptSettings(u.clinicId, ReceiptSettingsSchema.parse(body));
  }
}
