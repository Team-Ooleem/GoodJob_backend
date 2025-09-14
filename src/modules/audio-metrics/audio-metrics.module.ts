import { Module, forwardRef } from '@nestjs/common';
import { AnalysisClient } from './audio-metrics.client';
import { AudioMetricsService } from './audio-metrics.service';
import { DatabaseModule } from '../../database/database.module';
import { AppConfigModule } from '../../config/config.module';
import { AudioMetricsController } from './audio-metrics.controller';
import { CalibrationModule } from '../calibration/calibration.module';

@Module({
    imports: [DatabaseModule, AppConfigModule, forwardRef(() => CalibrationModule)],
    controllers: [AudioMetricsController],
    providers: [AudioMetricsService, AnalysisClient],
    exports: [AudioMetricsService, AnalysisClient],
})
export class AudioMetricsModule {}
