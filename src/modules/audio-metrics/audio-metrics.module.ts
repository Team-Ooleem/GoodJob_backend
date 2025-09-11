import { Module } from '@nestjs/common';
import { AnalysisClient } from './audio-metrics.client';
import { AudioMetricsService } from './audio-metrics.service';
import { DatabaseModule } from '../../database/database.module';
import { AppConfigModule } from '../../config/config.module';
import { AudioMetricsController } from './audio-metrics.controller';

@Module({
    imports: [DatabaseModule, AppConfigModule],
    controllers: [AudioMetricsController],
    providers: [AudioMetricsService, AnalysisClient],
    exports: [AudioMetricsService, AnalysisClient],
})
export class AudioMetricsModule {}
