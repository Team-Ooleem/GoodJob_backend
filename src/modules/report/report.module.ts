import { Module } from '@nestjs/common';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { MetricsModule } from '../metrics/metrics.module';
import { AudioMetricsService } from '../audio-metrics/audio-metrics.service';
import { DatabaseModule } from '../../database/database.module';
import { CalibrationModule } from '../calibration/calibration.module';

@Module({
    imports: [MetricsModule, DatabaseModule, CalibrationModule],
    controllers: [ReportController],
    providers: [ReportService, AudioMetricsService],
    exports: [ReportService],
})
export class ReportModule {}
