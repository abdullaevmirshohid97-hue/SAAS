import { Module } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';

import { PublicController } from './public.controller';
import { PublicService } from './public.service';

@Module({
  controllers: [PublicController],
  providers: [PublicService, SupabaseService],
})
export class PublicModule {}
