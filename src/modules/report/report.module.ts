import { Module } from '@nestjs/common';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { MetricsModule } from '../metrics/metrics.module';
import { AudioMetricsService } from '../audio-metrics/audio-metrics.service';
import { DatabaseModule } from '../../database/database.module';
import { CalibrationModule } from '../calibration/calibration.module';
import { OpenAIModule } from '../openai/openai.module';
import { TextAnalysisService } from './services/text-analysis.service';
import { AudioAnalysisService } from './services/audio-analysis.service';
import { VisualAnalysisService } from './services/visual-analysis.service';
import { ScoreCalculationService } from './services/score-calculation.service';

@Module({
    imports: [MetricsModule, DatabaseModule, CalibrationModule, OpenAIModule],
    controllers: [ReportController],
    providers: [
        ReportService,
        AudioMetricsService,
        TextAnalysisService,
        AudioAnalysisService,
        VisualAnalysisService,
        ScoreCalculationService,
    ],
    exports: [ReportService],
})
export class ReportModule {}
