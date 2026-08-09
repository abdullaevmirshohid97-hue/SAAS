import { Module } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';

import {
  PatientPortalController,
  ClinicAppointmentRequestsController,
} from './patient-portal.controller';
import { PatientPortalService } from './patient-portal.service';
import { SmsOtpService } from './sms-otp.service';

@Module({
  controllers: [PatientPortalController, ClinicAppointmentRequestsController],
  providers: [PatientPortalService, SmsOtpService, SupabaseService],
  // PatientPortalService — bemor Telegram boti navbat olishda shu servisdan
  // foydalanadi (slot ro'yxati + band qilish mantig'i takrorlanmasin).
  exports: [SmsOtpService, PatientPortalService],
})
export class PatientPortalModule {}
