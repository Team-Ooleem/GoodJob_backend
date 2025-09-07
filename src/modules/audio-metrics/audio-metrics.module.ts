import { Module } from '@nestjs/common';
import { AnalysisClient } from './audio-metrics.client';

@Module({
    providers: [AnalysisClient],
    exports: [AnalysisClient],
})
export class AnalysisModule {}
