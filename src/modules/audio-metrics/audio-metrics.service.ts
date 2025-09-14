// src/modules/audio-metrics/audio-metrics.service.ts
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export type AudioFeatures = {
    f0_mean?: number;
    f0_std?: number;
    f0_cv?: number;
    f0_std_semitone?: number;
    rms_std?: number;
    rms_cv?: number;
    jitter_like?: number;
    shimmer_like?: number;
    silence_ratio?: number;
    sr?: number;
};

/** 음성 정규화 점수 결과 타입 */
export interface AudioNormalizedScoreResult {
    score: number;
    calibrationApplied: boolean;
}

/** DB Row 타입 (audio_metrics_question) - 캘리브레이션 필드 포함 */
interface AudioMetricsQuestionRow {
    session_id: string;
    question_id: string;
    f0_mean: number | null;
    f0_std: number | null;
    f0_cv: number | null;
    f0_std_semitone: number | null;
    rms_std: number | null;
    rms_cv: number | null;
    jitter_like: number | null;
    shimmer_like: number | null;
    silence_ratio: number | null;
    sr: number | null;
    normalized_score: number | null;
    calibration_applied: number;
    updated_at: string;
}

@Injectable()
export class AudioMetricsService {
    constructor(private readonly db: DatabaseService) {}

    async upsertQuestionMetrics(sessionId: string, questionId: string, m: AudioFeatures) {
        await this.db.execute(
            `INSERT INTO audio_metrics_question
       (session_id, question_id, f0_mean, f0_std, f0_cv, f0_std_semitone, rms_std, rms_cv, jitter_like, shimmer_like, silence_ratio, sr)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
        f0_mean=VALUES(f0_mean), f0_std=VALUES(f0_std), f0_cv=VALUES(f0_cv), f0_std_semitone=VALUES(f0_std_semitone),
        rms_std=VALUES(rms_std), rms_cv=VALUES(rms_cv), jitter_like=VALUES(jitter_like), shimmer_like=VALUES(shimmer_like),
        silence_ratio=VALUES(silence_ratio), sr=VALUES(sr)`,
            [
                sessionId,
                questionId,
                m.f0_mean ?? null,
                m.f0_std ?? null,
                m.f0_cv ?? null,
                m.f0_std_semitone ?? null,
                m.rms_std ?? null,
                m.rms_cv ?? null,
                m.jitter_like ?? null,
                m.shimmer_like ?? null,
                m.silence_ratio ?? null,
                m.sr ?? null,
            ],
        );
    }

    async getSessionAudioOverall(sessionId: string): Promise<Partial<AudioFeatures> | null> {
        const rows = await this.db.query<Partial<AudioFeatures>>(
            `SELECT AVG(f0_mean) AS f0_mean, AVG(f0_std) AS f0_std, AVG(f0_cv) AS f0_cv,
              AVG(f0_std_semitone) AS f0_std_semitone, AVG(rms_std) AS rms_std, AVG(rms_cv) AS rms_cv,
              AVG(jitter_like) AS jitter_like, AVG(shimmer_like) AS shimmer_like, AVG(silence_ratio) AS silence_ratio
       FROM audio_metrics_question WHERE session_id=?`,
            [sessionId],
        );
        return rows.length ? rows[0] : null;
    }

    async getPerQuestion(sessionId: string) {
        return this.db.query<AudioMetricsQuestionRow>(
            `SELECT * FROM audio_metrics_question WHERE session_id=? ORDER BY question_id`,
            [sessionId],
        );
    }

    /**
     * 음성 정규화 점수 조회
     */
    async getNormalizedAudioScore(
        sessionId: string,
        questionId: string,
    ): Promise<AudioNormalizedScoreResult | null> {
        const rows = await this.db.query<{
            normalized_score: number | null;
            calibration_applied: number;
        }>(
            `SELECT normalized_score, calibration_applied 
             FROM audio_metrics_question 
             WHERE session_id=? AND question_id=?`,
            [sessionId, questionId],
        );

        if (rows.length === 0 || rows[0].normalized_score === null) {
            return null;
        }

        return {
            score: rows[0].normalized_score,
            calibrationApplied: rows[0].calibration_applied === 1,
        };
    }

    /**
     * 세션의 모든 문항별 정규화 점수 조회 (전체 평가용)
     */
    async getSessionNormalizedScores(sessionId: string): Promise<{
        questionScores: Array<{
            questionId: string;
            score: number;
            calibrationApplied: boolean;
        }>;
        averageScore: number;
        calibrationCoverage: number; // 캘리브레이션 적용 비율
    }> {
        const rows = await this.db.query<{
            question_id: string;
            normalized_score: number | null;
            calibration_applied: number;
        }>(
            `SELECT question_id, normalized_score, calibration_applied 
             FROM audio_metrics_question 
             WHERE session_id=? AND normalized_score IS NOT NULL
             ORDER BY question_id`,
            [sessionId],
        );

        const questionScores = rows.map((row) => ({
            questionId: row.question_id,
            score: row.normalized_score || 0,
            calibrationApplied: row.calibration_applied === 1,
        }));

        const totalScores = questionScores.reduce((sum, q) => sum + q.score, 0);
        const averageScore = questionScores.length > 0 ? totalScores / questionScores.length : 0;

        const calibratedCount = questionScores.filter((q) => q.calibrationApplied).length;
        const calibrationCoverage =
            questionScores.length > 0 ? calibratedCount / questionScores.length : 0;

        return {
            questionScores,
            averageScore,
            calibrationCoverage,
        };
    }

    /**
     * 특정 문항의 원본 음성 특성 조회 (디버깅/분석용)
     */
    async getQuestionAudioFeatures(
        sessionId: string,
        questionId: string,
    ): Promise<AudioFeatures | null> {
        const rows = await this.db.query<AudioMetricsQuestionRow>(
            `SELECT * FROM audio_metrics_question WHERE session_id=? AND question_id=?`,
            [sessionId, questionId],
        );

        if (rows.length === 0) return null;

        const row = rows[0];
        return {
            f0_mean: row.f0_mean || undefined,
            f0_std: row.f0_std || undefined,
            f0_cv: row.f0_cv || undefined,
            f0_std_semitone: row.f0_std_semitone || undefined,
            rms_std: row.rms_std || undefined,
            rms_cv: row.rms_cv || undefined,
            jitter_like: row.jitter_like || undefined,
            shimmer_like: row.shimmer_like || undefined,
            silence_ratio: row.silence_ratio || undefined,
            sr: row.sr || undefined,
        };
    }

    /**
     * 세션의 음성 품질 통계 조회 (전체 면접 품질 평가용)
     */
    async getSessionAudioQualityStats(sessionId: string): Promise<{
        questionCount: number;
        averageJitter: number;
        averageShimmer: number;
        averageSilenceRatio: number;
        f0Stability: number; // F0 표준편차의 평균
        overallQuality: 'excellent' | 'good' | 'fair' | 'poor';
    } | null> {
        const rows = await this.db.query<{
            avg_jitter: number | null;
            avg_shimmer: number | null;
            avg_silence: number | null;
            avg_f0_std: number | null;
            question_count: number;
        }>(
            `SELECT 
                AVG(jitter_like) as avg_jitter,
                AVG(shimmer_like) as avg_shimmer,
                AVG(silence_ratio) as avg_silence,
                AVG(f0_std) as avg_f0_std,
                COUNT(*) as question_count
             FROM audio_metrics_question 
             WHERE session_id=?`,
            [sessionId],
        );

        if (rows.length === 0 || rows[0].question_count === 0) return null;

        const stats = rows[0];
        const avgJitter = stats.avg_jitter || 0;
        const avgShimmer = stats.avg_shimmer || 0;
        const avgSilence = stats.avg_silence || 0;
        const f0Stability = stats.avg_f0_std || 0;

        // 음성 품질 등급 결정
        let overallQuality: 'excellent' | 'good' | 'fair' | 'poor';
        if (avgJitter < 0.02 && avgShimmer < 0.05 && avgSilence < 0.2) {
            overallQuality = 'excellent';
        } else if (avgJitter < 0.05 && avgShimmer < 0.1 && avgSilence < 0.4) {
            overallQuality = 'good';
        } else if (avgJitter < 0.1 && avgShimmer < 0.2 && avgSilence < 0.6) {
            overallQuality = 'fair';
        } else {
            overallQuality = 'poor';
        }

        return {
            questionCount: stats.question_count,
            averageJitter: avgJitter,
            averageShimmer: avgShimmer,
            averageSilenceRatio: avgSilence,
            f0Stability,
            overallQuality,
        };
    }
}
