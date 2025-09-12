import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { VisualAggregateDto } from './dto/visual-aggregate.dto';

@Controller('metrics')
export class MetricsController {
    constructor(private readonly svc: MetricsService) {}

    /**
     * 문항 종료 시, 프론트에서 집계 결과를 1회 전송(업서트)
     */
    @Post(':sessionId/:questionId/aggregate')
    async upsertQuestionAggregate(
        @Param('sessionId') sessionId: string,
        @Param('questionId') questionId: string,
        @Body() dto: VisualAggregateDto,
        @Req() req: any,
    ) {
        const userId = Number(req.user_idx ?? req.user?.idx);
        await this.svc.upsertQuestionAggregate(sessionId, questionId, dto, userId);
        return { ok: true };
    }

    /**
     * 면접 종료 시점에 세션 전체 집계(문항 집계의 가중 평균/합산) 저장 및 반환
     */
    @Post(':sessionId/finalize')
    async finalizeSession(@Param('sessionId') sessionId: string, @Req() req: any) {
        const userId = Number(req.user_idx ?? req.user?.idx);
        const aggregate = await this.svc.finalizeSession(sessionId, userId);
        return { ok: true, aggregate };
    }

    /**
     * 저장된 문항별 집계 조회
     */
    @Get(':sessionId/:questionId')
    async getQuestionAggregate(
        @Param('sessionId') sessionId: string,
        @Param('questionId') questionId: string,
    ) {
        const agg = await this.svc.getQuestionAggregate(sessionId, questionId);
        return { ok: true, aggregate: agg };
    }

    /**
     * 저장된 세션 집계 + 문항별 집계 묶어서 조회
     */
    @Get(':sessionId')
    async getSessionAggregate(@Param('sessionId') sessionId: string) {
        const aggregate = await this.svc.getSessionAggregate(sessionId);
        return { ok: true, aggregate };
    }
}
