import { Module } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';

import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';

@Module({
  controllers: [DemoController],
  providers: [DemoService, SupabaseService],
})
export class DemoModule {}
