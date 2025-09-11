import { Module } from '@nestjs/common';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { MetricsModule } from '../metrics/metrics.module';
import { AudioMetricsService } from '../audio-metrics/audio-metrics.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
    imports: [MetricsModule, DatabaseModule],
    controllers: [ReportController],
    providers: [ReportService, AudioMetricsService],
    exports: [ReportService],
})
export class ReportModule {}
