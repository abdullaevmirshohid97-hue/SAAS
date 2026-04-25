import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { TerminusModule } from '@nestjs/terminus';
import { JwtModule } from '@nestjs/jwt';

import { AuthGuard } from './common/guards/auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { SupabaseService } from './common/services/supabase.service';

import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { PublicModule } from './modules/public/public.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { PatientsModule } from './modules/patients/patients.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { QueuesModule } from './modules/queues/queues.module';
import { ReferralsModule } from './modules/referrals/referrals.module';
import { PrescriptionsModule } from './modules/prescriptions/prescriptions.module';
import { DiagnosticsModule } from './modules/diagnostics/diagnostics.module';
import { LabModule } from './modules/lab/lab.module';
import { PharmacyModule } from './modules/pharmacy/pharmacy.module';
import { InpatientModule } from './modules/inpatient/inpatient.module';
import { BillingModule } from './modules/billing/billing.module';
import { PaymentQrModule } from './modules/payments/payment-qr.module';
import { ReceptionModule } from './modules/reception/reception.module';
import { ShiftsModule } from './modules/shifts/shifts.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { VaultModule } from './modules/vault/vault.module';
import { MarketingModule } from './modules/marketing/marketing.module';
import { SupportChatModule } from './modules/support-chat/support-chat.module';
import { TelegramBackupModule } from './modules/telegram-backup/telegram-backup.module';
import { AdminModule } from './modules/admin/admin.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { CashierModule } from './modules/cashier/cashier.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { StaffModule } from './modules/staff/staff.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { SiteCmsModule } from './modules/site-cms/site-cms.module';
import { NurseModule } from './modules/nurse/nurse.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env.local',
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 1000 },
      { name: 'public', ttl: 60_000, limit: 100 },
    ]),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    }),
    JwtModule.register({
      global: true,
      secret: process.env.SUPABASE_JWT_SECRET ?? 'dev-secret-change-me',
    }),
    TerminusModule,

    HealthModule,
    PublicModule,
    AuthModule,
    CatalogModule,
    PatientsModule,
    AppointmentsModule,
    QueuesModule,
    ReferralsModule,
    PrescriptionsModule,
    DiagnosticsModule,
    LabModule,
    PharmacyModule,
    InpatientModule,
    BillingModule,
    PaymentQrModule,
    ReceptionModule,
    ShiftsModule,
    SubscriptionModule,
    VaultModule,
    MarketingModule,
    SupportChatModule,
    TelegramBackupModule,
    AdminModule,
    WebhooksModule,
    AuditModule,
    NotificationsModule,
    CashierModule,
    AnalyticsModule,
    StaffModule,
    PayrollModule,
    SiteCmsModule,
    NurseModule,
  ],
  providers: [
    SupabaseService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
