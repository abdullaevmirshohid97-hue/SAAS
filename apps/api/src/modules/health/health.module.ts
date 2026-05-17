import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { SupabaseService } from '../../common/services/supabase.service';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [SupabaseService],
})
export class HealthModule {}
