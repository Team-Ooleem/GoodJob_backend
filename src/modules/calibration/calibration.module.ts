// src/modules/calibration/calibration.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { CalibrationService } from './calibration.service';
import { CalibrationController } from './calibration.controller';
import { AudioMetricsModule } from '../audio-metrics/audio-metrics.module';

@Module({
    imports: [DatabaseModule, forwardRef(() => AudioMetricsModule)], // DB, AnalysisClient 사용을 위해
    controllers: [CalibrationController],
    providers: [CalibrationService],
    exports: [CalibrationService], // 다른 모듈에서 사용할 수 있도록
})
export class CalibrationModule {}
