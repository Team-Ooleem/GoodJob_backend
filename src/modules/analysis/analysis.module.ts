import { Module } from '@nestjs/common';
import { AnalysisClient } from './analysis.client';

@Module({
    providers: [AnalysisClient],
    exports: [AnalysisClient],
})
export class AnalysisModule {}
