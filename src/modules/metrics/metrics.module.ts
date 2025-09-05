// src/modules/metrics/metrics.module.ts
import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { DatabaseModule } from '../../database/database.module'; // 정확한 경로 확인!

@Module({
    imports: [DatabaseModule], // ⭐ 여기 꼭 필요
    controllers: [MetricsController],
    providers: [MetricsService],
    exports: [MetricsService], // InterviewService에서 주입받아 사용
})
export class MetricsModule {}
