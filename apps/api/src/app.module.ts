import { Module } from '@nestjs/common';
import { appAuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/config.module.js';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health/health.controller.js';
import { MeController } from './me/me.controller.js';
import { TrailsModule } from './trails/trails.module.js';

@Module({
  imports: [ConfigModule, DbModule, appAuthModule, TrailsModule],
  controllers: [HealthController, MeController],
})
export class AppModule {}
