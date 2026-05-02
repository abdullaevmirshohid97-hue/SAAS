import { Module } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';

import { PatientPortalController } from './patient-portal.controller';
import { PatientPortalService } from './patient-portal.service';
import { SmsOtpService } from './sms-otp.service';

@Module({
  controllers: [PatientPortalController],
  providers: [PatientPortalService, SmsOtpService, SupabaseService],
  exports: [SmsOtpService],
})
export class PatientPortalModule {}
