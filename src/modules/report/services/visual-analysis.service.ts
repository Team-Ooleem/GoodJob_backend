import { Injectable } from '@nestjs/common';
import { MetricsService, SessionVisualAggregate } from '../../metrics/metrics.service';
import { DatabaseService } from '../../../database/database.service';

export type VisualSummary = {
    confidenceScore: number; // 0-100
    behaviorScore: number; // 0-100 (presence good 비율)
    alertRatioPercent: number; // 0-100 (warning+critical 비중)
    overallScore10: number; // 0-10 스케일
    overall?: SessionVisualAggregate['overall'] | null; // 세션 전체 집계
    questionScores?: Array<{
        questionId: string;
        score: number; // 0-100 정규화 점수
        calibrationApplied: boolean;
    }>;
    calibrationCoverage?: number; // 정규화 적용 비율
};

@Injectable()
export class VisualAnalysisService {
    constructor(
        private readonly metrics: MetricsService,
        private readonly db: DatabaseService,
    ) {}

    // 질문 ID 목록 조회
    private async getQuestionIds(sessionId: string): Promise<string[]> {
        const rows = await this.db.query<{ question_id: string }>(
            `SELECT DISTINCT question_id FROM visual_agg_question WHERE session_id = ?`,
            [sessionId],
        );
        return rows.map((r) => r.question_id);
    }

    // 종합 영상 지표 계산(캘리브레이션 고려) + 서브지표 제공
    async getVisualSummary(sessionId: string): Promise<VisualSummary> {
        const agg = await this.metrics.getSessionAggregate(sessionId);
        const overall = agg?.overall ?? null;

        // 서브 지표 계산
        const confidenceScore =
            overall?.confidence_mean != null
                ? Math.round(Math.max(0, Math.min(1, overall.confidence_mean)) * 100)
                : 0;

        const presenceTotal = overall
            ? (overall.presence_dist?.good ?? 0) +
              (overall.presence_dist?.average ?? 0) +
              (overall.presence_dist?.needs_improvement ?? 0)
            : 0;
        const behaviorScore =
            presenceTotal > 0
                ? Math.round(((overall!.presence_dist.good || 0) / presenceTotal) * 100)
                : 0;

        const levelTotal = overall
            ? (overall.level_dist?.ok ?? 0) +
              (overall.level_dist?.info ?? 0) +
              (overall.level_dist?.warning ?? 0) +
              (overall.level_dist?.critical ?? 0)
            : 0;
        const alertRatioPercent =
            levelTotal > 0
                ? Math.round(
                      (((overall!.level_dist.warning || 0) + (overall!.level_dist.critical || 0)) /
                          levelTotal) *
                          100,
                  )
                : 0;

        // 문항별 정규화 점수 수집
        const questionIds = await this.getQuestionIds(sessionId);
        const questionScores: Array<{
            questionId: string;
            score: number;
            calibrationApplied: boolean;
        }> = [];
        let sum = 0;
        let count = 0;
        let calibratedCount = 0;
        for (const qid of questionIds) {
            const r = await this.metrics.getNormalizedVisualScore(sessionId, qid);
            if (r && r.score != null) {
                questionScores.push({
                    questionId: qid,
                    score: r.score,
                    calibrationApplied: r.calibrationApplied,
                });
                sum += r.score;
                count++;
                if (r.calibrationApplied) calibratedCount++;
            }
        }

        let overallScore10: number = 0;
        let coverage = 0;
        if (count > 0) {
            const avgScore = sum / count; // 0-100
            coverage = calibratedCount / count;
            const reliabilityWeight = 0.7 + coverage * 0.3;
            overallScore10 = Math.round((avgScore / 100) * 10 * reliabilityWeight);
        }

        return {
            confidenceScore,
            behaviorScore,
            alertRatioPercent,
            overallScore10,
            overall,
            questionScores,
            calibrationCoverage: coverage,
        };
    }
}
