import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { AllowWithoutClinic } from '../../common/decorators/allow-without-clinic.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

import { AuthService } from './auth.service';

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
  @Post('check-slug')
  checkSlug(@Body() body: { slug: string }) {
    return this.svc.slugAvailable(body.slug);
  }
}
