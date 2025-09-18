import { Injectable } from '@nestjs/common';
import { AudioMetricsService, AudioFeatures } from '../../audio-metrics/audio-metrics.service';

export type AudioSummary = {
    toneScore: number; // 0-100
    vibratoScore: number; // 0-100
    paceScore: number; // 0-100
    overallScore10: number; // 0-10 스케일
    averages?: Partial<AudioFeatures> | null; // 평균 원본 특성치
    questionScores?: Array<{
        questionId: string;
        score: number; // 0-100 정규화 점수
        calibrationApplied: boolean;
    }>;
    calibrationCoverage?: number; // 정규화 적용 비율
};

@Injectable()
export class AudioAnalysisService {
    constructor(private readonly audio: AudioMetricsService) {}

    // 종합 음성 지표 계산(캘리브레이션 고려) + 서브점수 제공
    async getAudioSummary(sessionId: string): Promise<AudioSummary> {
        const [normalized, averages] = await Promise.all([
            this.audio.getSessionNormalizedScores(sessionId),
            this.audio.getSessionAudioOverall(sessionId),
        ]);

        const subs = this.computeAudioSubScoresFromFeatures(averages || undefined);

        let overallScore10: number;
        if (normalized.questionScores.length > 0) {
            const avgScore = normalized.averageScore; // 0-100
            const reliabilityWeight = 0.7 + normalized.calibrationCoverage * 0.3;
            overallScore10 = Math.round((avgScore / 100) * 10 * reliabilityWeight);
        } else {
            // 폴백: 서브점수 평균을 사용하여 10점 스케일 계산
            const avg100 = (subs.toneScore + subs.vibratoScore + subs.paceScore) / 3;
            overallScore10 = Math.round(avg100 / 10);
        }

        return {
            toneScore: subs.toneScore,
            vibratoScore: subs.vibratoScore,
            paceScore: subs.paceScore,
            overallScore10,
            averages: averages || null,
            questionScores: normalized.questionScores,
            calibrationCoverage: normalized.calibrationCoverage,
        };
    }

    // 평균 특성치로부터 서브 점수(tone/vibrato/pace) 계산 (0-100)
    private computeAudioSubScoresFromFeatures(features?: Partial<AudioFeatures>): {
        toneScore: number;
        vibratoScore: number;
        paceScore: number;
    } {
        if (!features) return { toneScore: 75, vibratoScore: 75, paceScore: 75 };

        const f = features as AudioFeatures;

        // 톤 안정성 (CV 기반)
        const cv =
            typeof f.f0_cv === 'number' && isFinite(f.f0_cv) && f.f0_cv >= 0
                ? f.f0_cv
                : typeof f.f0_mean === 'number' && f.f0_mean > 0
                  ? (f.f0_std ?? 0) / f.f0_mean
                  : undefined;
        const toneScore =
            cv !== undefined
                ? Math.round((1 - Math.min(1, Math.max(0, (cv - 0.05) / 0.3))) * 100)
                : 75;

        // 진동 점수 (jitter/shimmer)
        const jitterNorm = Math.min(1, (f.jitter_like ?? 0) / 1.0);
        const shimmerNorm = Math.min(1, (f.shimmer_like ?? 0) / 1.0);
        const vibratoScore = Math.round((1 - (jitterNorm * 0.5 + shimmerNorm * 0.5)) * 100);

        // 페이스 점수 (침묵 비율 → 발화 비율)
        const talkRatio = 1 - (f.silence_ratio ?? 0);
        const paceScore = Math.round((1 - Math.abs(talkRatio - 0.6) / 0.6) * 100);

        return { toneScore, vibratoScore, paceScore };
    }
}
