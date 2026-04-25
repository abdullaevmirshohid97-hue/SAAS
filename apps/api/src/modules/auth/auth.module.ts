import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { SupabaseService } from '../../common/services/supabase.service';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.SUPABASE_JWT_SECRET,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SupabaseService],
})
export class AuthModule {}
