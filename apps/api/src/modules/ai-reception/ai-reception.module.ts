import { Module } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReceptionModule } from '../reception/reception.module';
import { TelegramReportsModule } from '../telegram-reports/telegram-reports.module';
import { VaultModule } from '../vault/vault.module';

import { AdminAiReceptionController } from './admin-ai-reception.controller';
import { AiReceptionController } from './ai-reception.controller';
import { BookingService } from './booking.service';
import { ReceptionBrainService } from './brain.service';
import { PatientNotifierService } from './patient-notifier.service';
import { AiReceptionRemindersService } from './reminders.service';
import { AiReceptionSettingsService } from './settings.service';
import { SttClient } from './stt.client';
import { AiReceptionVoiceController } from './voice.controller';

// =============================================================================
// AI QABULXONA — telefon (voice-agent), Telegram, qabulxona navbat dvigateli
// =============================================================================
// Batafsil: docs/ai-reception/README.md
// TelegramPatientModule bu modulni import qiladi (bot navbat oqimi) — teskari
// import YO'Q (aylana bog'liqlik bo'lmasin).
// =============================================================================

@Module({
  imports: [VaultModule, ReceptionModule, NotificationsModule, TelegramReportsModule],
  controllers: [AiReceptionController, AiReceptionVoiceController, AdminAiReceptionController],
  providers: [
    SupabaseService,
    AiReceptionSettingsService,
    BookingService,
    PatientNotifierService,
    ReceptionBrainService,
    AiReceptionRemindersService,
    SttClient,
  ],
  exports: [
    AiReceptionSettingsService,
    BookingService,
    ReceptionBrainService,
    SttClient,
    PatientNotifierService,
  ],
})
export class AiReceptionModule {}
