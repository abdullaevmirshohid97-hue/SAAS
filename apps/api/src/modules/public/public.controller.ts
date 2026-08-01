import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Public } from '../../common/decorators/public.decorator';

import { PublicService } from './public.service';

const NewsletterSchema = z.object({
  email: z.string().email(),
  locale: z.string().default('uz-Latn'),
  source: z.string().optional(),
  turnstileToken: z.string().min(1),
});

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2),
  acceptedTerms: z.boolean().refine((v) => v === true),
  turnstileToken: z.string().min(1),
});

const ContactSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  clinicName: z.string().optional(),
  message: z.string().min(10),
  turnstileToken: z.string().min(1),
});

// Landing demo formalari (book-demo.astro, clinics.astro) maydonlarni snake_case
// yuboradi, email esa ixtiyoriy — O'zbekistonda telefon birlamchi aloqa vositasi.
// Ilgari bu sxema ContactSchema'dan meros olardi: camelCase + majburiy email +
// majburiy message(min 10) + majburiy turnstileToken. Formalar bularning HECH
// BIRINI yubormaydi → har bir demo so'rovi 400 bilan yiqilib, lid yo'qolgan.
// Endi ikkala yozuv uslubi ham qabul qilinadi va normallashtiriladi.
const DemoRequestSchema = z
  .object({
    fullName: z.string().min(2).optional(),
    name: z.string().min(2).optional(),
    full_name: z.string().min(2).optional(),
    clinicName: z.string().optional(),
    clinic_name: z.string().optional(),
    email: z.union([z.string().email(), z.literal('')]).optional(),
    phone: z.string().min(3).max(40).optional(),
    message: z.string().optional(),
    notes: z.string().optional(),
    size: z.string().optional(),
    staffCountBucket: z.string().optional(),
    time_pref: z.string().optional(),
    organizationType: z.enum(['clinic', 'hospital', 'diagnostic_center', 'dental']).optional(),
    turnstileToken: z.string().optional(),
  })
  .transform((d) => ({
    fullName: (d.fullName ?? d.name ?? d.full_name ?? '').trim(),
    clinicName: d.clinicName ?? d.clinic_name,
    email: d.email || undefined,
    phone: d.phone,
    // Erkin matnli maydonlarni bitta izohga birlashtiramiz — yo'qolmasin.
    message:
      [d.message, d.notes, d.time_pref ? `Qulay vaqt: ${d.time_pref}` : null]
        .filter(Boolean)
        .join(' · ') || undefined,
    staffCountBucket: d.staffCountBucket ?? d.size,
    organizationType: d.organizationType,
    turnstileToken: d.turnstileToken,
  }))
  .refine((d) => d.fullName.length >= 2, { message: 'Ism kiritilishi shart' })
  .refine((d) => Boolean(d.phone || d.email), {
    message: 'Telefon yoki email kiritilishi shart',
  });

const LeadSchema = z
  .object({
    source: z.string().min(1).max(64).default('landing'),
    full_name: z.string().min(2).optional(),
    fullName: z.string().min(2).optional(),
    email: z.string().email(),
    phone: z.string().min(3).max(40).optional(),
    clinic_name: z.string().optional(),
    clinicName: z.string().optional(),
    message: z.string().optional(),
    size: z.string().optional(),
    specialty: z.string().optional(),
  })
  .passthrough();

@ApiTags('public')
@Controller('public')
export class PublicController {
  constructor(private readonly svc: PublicService) {}

  @Public()
  @Post('newsletter')
  @Throttle({ public: { ttl: 60_000, limit: 5 } })
  async newsletter(@Body() body: z.infer<typeof NewsletterSchema>) {
    const data = NewsletterSchema.parse(body);
    await this.svc.verifyTurnstile(data.turnstileToken);
    await this.svc.subscribeNewsletter(data);
    return { ok: true };
  }

  @Public()
  @Post('signup')
  @Throttle({ public: { ttl: 60_000, limit: 3 } })
  async signup(@Body() body: z.infer<typeof SignupSchema>) {
    const data = SignupSchema.parse(body);
    await this.svc.verifyTurnstile(data.turnstileToken);
    return this.svc.signup(data);
  }

  @Public()
  @Post('contact')
  @Throttle({ public: { ttl: 60_000, limit: 3 } })
  async contact(@Body() body: z.infer<typeof ContactSchema>) {
    const data = ContactSchema.parse(body);
    await this.svc.verifyTurnstile(data.turnstileToken);
    await this.svc.createLead({ ...data, source: 'contact_form' });
    return { ok: true };
  }

  @Public()
  @Post('demo-request')
  @Throttle({ public: { ttl: 60_000, limit: 3 } })
  async demo(@Body() body: unknown) {
    const data = DemoRequestSchema.parse(body);
    await this.svc.verifyTurnstile(data.turnstileToken ?? '');
    await this.svc.createLead({ ...data, source: 'demo_form' });
    return { ok: true };
  }

  @Public()
  @Get('app-versions')
  async appVersions(@Query('app') app?: string, @Query('channel') channel?: string) {
    return this.svc.listAppVersions({ app, channel });
  }

  @Public()
  @Post('leads')
  @Throttle({ public: { ttl: 60_000, limit: 10 } })
  async leads(@Body() body: unknown) {
    const data = LeadSchema.parse(body);
    const fullName = data.full_name ?? data.fullName ?? data.email;
    const clinicName = data.clinic_name ?? data.clinicName;
    await this.svc.createLead({
      fullName,
      email: data.email,
      phone: data.phone,
      clinicName,
      message: data.message,
      organizationType: data.specialty,
      staffCountBucket: data.size,
      source: data.source,
    });
    return { ok: true };
  }

  @Public()
  @Post('demo-session')
  @Throttle({ public: { ttl: 60_000, limit: 5 } })
  async demoSession(
    @Body() body: { locale?: string; fingerprint?: string; turnstileToken?: string },
  ) {
    if (body?.turnstileToken) await this.svc.verifyTurnstile(body.turnstileToken);
    return this.svc.createDemoSession({
      locale: body?.locale,
      fingerprint: body?.fingerprint,
    });
  }
}
