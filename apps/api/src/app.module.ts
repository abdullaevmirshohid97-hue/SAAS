import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { TerminusModule } from '@nestjs/terminus';
import { JwtModule } from '@nestjs/jwt';

import { AuthGuard } from './common/guards/auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { SubscriptionGuard } from './common/guards/subscription.guard';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { SupabaseService } from './common/services/supabase.service';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { AdminActionsInterceptor } from './common/interceptors/admin-actions.interceptor';

import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { PublicModule } from './modules/public/public.module';
import { PatientPortalModule } from './modules/patient-portal/patient-portal.module';
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
import { DataAdminModule } from './modules/data-admin/data-admin.module';
import { TrashModule } from './modules/trash/trash.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { VaultModule } from './modules/vault/vault.module';
import { MarketingModule } from './modules/marketing/marketing.module';
import { SupportChatModule } from './modules/support-chat/support-chat.module';
import { TelegramBackupModule } from './modules/telegram-backup/telegram-backup.module';
import { AdminModule } from './modules/admin/admin.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { NotificationsFeedModule } from './modules/notifications-feed/notifications-feed.module';
import { CashierModule } from './modules/cashier/cashier.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { StaffModule } from './modules/staff/staff.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { SiteCmsModule } from './modules/site-cms/site-cms.module';
import { NurseModule } from './modules/nurse/nurse.module';
import { JournalModule } from './modules/journal/journal.module';
import { StaffProfilesModule } from './modules/staff-profiles/staff-profiles.module';
import { NursePortalModule } from './modules/nurse-portal/nurse-portal.module';
import { DemoModule } from './modules/demo/demo.module';
import { LeadsModule } from './modules/leads/leads.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { TelegramReportsModule } from './modules/telegram-reports/telegram-reports.module';
import { PublicBotModule } from './modules/public-bot/public-bot.module';
import { PatientLoginsModule } from './modules/patient-logins/patient-logins.module';
import { ThermalPrintersModule } from './modules/thermal-printers/thermal-printers.module';
import { Icd10Module } from './modules/icd10/icd10.module';
import { DoctorModule } from './modules/doctor/doctor.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { DentalModule } from './modules/dental/dental.module';
import { AiModule } from './modules/ai/ai.module';
import { ReportSchedulesModule } from './modules/report-schedules/report-schedules.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { InsuranceModule } from './modules/insurance/insurance.module';
import { CompanyModule } from './modules/company/company.module';
import { FixedAssetsModule } from './modules/fixed-assets/fixed-assets.module';
import { BankModule } from './modules/bank/bank.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { AdminClinicModule } from './modules/admin/admin-clinic.module';
import { DmedModule } from './modules/dmed/dmed.module';
import { CastModule } from './modules/cast/cast.module';

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
    PatientPortalModule,
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
    DataAdminModule,
    TrashModule,
    SubscriptionModule,
    VaultModule,
    MarketingModule,
    SupportChatModule,
    TelegramBackupModule,
    AdminModule,
    WebhooksModule,
    AuditModule,
    TelegramModule,
    TelegramReportsModule,
    PublicBotModule,
    PatientLoginsModule,
    ThermalPrintersModule,
    Icd10Module,
    DoctorModule,
    NotificationsModule,
    NotificationsFeedModule,
    CashierModule,
    AnalyticsModule,
    StaffModule,
    PayrollModule,
    SiteCmsModule,
    NurseModule,
    JournalModule,
    StaffProfilesModule,
    NursePortalModule,
    DemoModule,
    LeadsModule,
    TransactionsModule,
    DentalModule,
    AiModule,
    ReportSchedulesModule,
    AccountingModule,
    ProcurementModule,
    InventoryModule,
    InsuranceModule,
    CompanyModule,
    FixedAssetsModule,
    BankModule,
    AnnouncementsModule,
    AdminClinicModule,
    DmedModule,
    CastModule,
  ],
  providers: [
    SupabaseService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: SubscriptionGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Audit interceptor — DI injects Reflector + SupabaseService so @Audit
    // decorators actually write to activity_journal via log_activity RPC.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // Super-admin mutatsiyalari auditi — admin_actions jadvaliga.
    { provide: APP_INTERCEPTOR, useClass: AdminActionsInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
