import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health/health.controller.js';
import { TrailsModule } from './trails/trails.module.js';

@Module({
  imports: [ConfigModule, DbModule, TrailsModule],
  controllers: [HealthController],
})
export class AppModule {}
