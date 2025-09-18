import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AudioFeatures } from '../audio-metrics/audio-metrics.service';
import { VisualAggregateDto } from '../metrics/dto/visual-aggregate.dto';

export interface CalibrationResult {
    userId: number;
    audioBaseline?: AudioFeatures;
    visualBaseline?: VisualAggregateDto;
    createdAt: Date;
    updatedAt: Date;
}

export interface NormalizationResult {
    raw: any;
    normalized: any;
    calibrationApplied: boolean;
    deviationScore?: number;
}

@Injectable()
export class CalibrationService {
    constructor(private readonly db: DatabaseService) {}

    private parseJsonMaybe(v: any) {
        if (v == null) return undefined;
        if (typeof v === 'string') {
            try {
                return JSON.parse(v);
            } catch {
                return undefined;
            }
        }
        if (typeof v === 'object') return v as any;
        return undefined;
    }

    /**
     * 세션별 캘리브레이션 데이터 저장
     */
    async saveSessionCalibration(
        sessionId: string,
        userId: number,
        audioFeatures?: AudioFeatures,
        visualFeatures?: VisualAggregateDto,
        calibrationText?: string,
        durationMs?: number,
    ): Promise<CalibrationResult | null> {
        await this.db.execute(
            `INSERT INTO session_calibrations 
            (session_id, user_id, audio_baseline, visual_baseline, calibration_text, duration_ms)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                audio_baseline = COALESCE(VALUES(audio_baseline), audio_baseline),
                visual_baseline = COALESCE(VALUES(visual_baseline), visual_baseline),
                calibration_text = COALESCE(VALUES(calibration_text), calibration_text),
                duration_ms = VALUES(duration_ms)`,
            [
                sessionId,
                userId,
                audioFeatures ? JSON.stringify(audioFeatures) : null,
                visualFeatures ? JSON.stringify(visualFeatures) : null,
                calibrationText || '나는 핀토스를 부순다.',
                durationMs || 0,
            ],
        );

        return this.getSessionCalibration(sessionId);
    }

    /**
     * 세션별 캘리브레이션 데이터 조회
     */
    async getSessionCalibration(sessionId: string): Promise<CalibrationResult | null> {
        const rows = await this.db.query<{
            session_id: string;
            user_id: number;
            audio_baseline: string | null;
            visual_baseline: string | null;
            created_at: Date;
        }>(
            `SELECT session_id, user_id, audio_baseline, visual_baseline, created_at
            FROM session_calibrations 
            WHERE session_id = ?`,
            [sessionId],
        );

        if (rows.length === 0) return null;

        const row = rows[0];
        return {
            userId: row.user_id,
            audioBaseline: this.parseJsonMaybe(row.audio_baseline),
            visualBaseline: this.parseJsonMaybe(row.visual_baseline),
            createdAt: row.created_at,
            updatedAt: row.created_at,
        };
    }

    /**
     * 음성 데이터 정규화 (세션별 기준값 사용)
     */
    async normalizeAudioFeatures(
        sessionId: string,
        rawFeatures: AudioFeatures,
    ): Promise<NormalizationResult> {
        const calibration = await this.getSessionCalibration(sessionId);

        if (!calibration?.audioBaseline) {
            return {
                raw: rawFeatures,
                normalized: rawFeatures,
                calibrationApplied: false,
            };
        }

        const baseline = calibration.audioBaseline;
        const normalized = this.computeAudioNormalization(rawFeatures, baseline);
        const deviationScore = this.computeAudioDeviationScore(rawFeatures, baseline);

        return {
            raw: rawFeatures,
            normalized,
            calibrationApplied: true,
            deviationScore,
        };
    }

    /**
     * 영상 데이터 정규화 (세션별 기준값 사용)
     */
    async normalizeVisualFeatures(
        sessionId: string,
        rawFeatures: VisualAggregateDto,
    ): Promise<NormalizationResult> {
        const calibration = await this.getSessionCalibration(sessionId);

        if (!calibration?.visualBaseline) {
            return {
                raw: rawFeatures,
                normalized: rawFeatures,
                calibrationApplied: false,
            };
        }

        const baseline = calibration.visualBaseline;
        const normalized = this.computeVisualNormalization(rawFeatures, baseline);
        const deviationScore = this.computeVisualDeviationScore(rawFeatures, baseline);

        return {
            raw: rawFeatures,
            normalized,
            calibrationApplied: true,
            deviationScore,
        };
    }

    /**
     * 정규화된 음성 점수를 DB에 저장
     */
    async saveNormalizedAudioScore(
        sessionId: string,
        questionId: string,
        normalizedScore: number,
        calibrationApplied: boolean,
    ): Promise<void> {
        await this.db.execute(
            `UPDATE audio_metrics_question 
            SET normalized_score = ?, calibration_applied = ?
            WHERE session_id = ? AND question_id = ?`,
            [normalizedScore, calibrationApplied ? 1 : 0, sessionId, questionId],
        );
    }

    /**
     * 정규화된 영상 점수를 DB에 저장
     */
    async saveNormalizedVisualScore(
        sessionId: string,
        questionId: string,
        normalizedScore: number,
        calibrationApplied: boolean,
    ): Promise<void> {
        await this.db.execute(
            `UPDATE visual_agg_question 
            SET normalized_score = ?, calibration_applied = ?
            WHERE session_id = ? AND question_id = ?`,
            [normalizedScore, calibrationApplied ? 1 : 0, sessionId, questionId],
        );
    }

    /**
     * 면접 세션에서 사용자 ID 조회 헬퍼
     */
    async getUserIdFromSession(sessionId: string): Promise<number | null> {
        const rows = await this.db.query<{ user_id: number }>(
            `SELECT user_id FROM interview_sessions WHERE session_id = ?`,
            [sessionId],
        );
        return rows.length > 0 ? rows[0].user_id : null;
    }

    /**
     * 캘리브레이션 효과 분석
     */
    async analyzeCalibrationEffectiveness(userId: number): Promise<{
        sessionsWithCalibration: number;
        sessionsWithoutCalibration: number;
        averageDeviationWithCalibration: number;
        averageDeviationWithoutCalibration: number;
        improvementPercentage: number;
    }> {
        // 간단한 통계만 제공 (실제 구현에서는 더 복잡한 분석 가능)
        const calibrationSessions = await this.db.query<{ count: number }>(
            `SELECT COUNT(*) as count FROM session_calibrations WHERE user_id = ?`,
            [userId],
        );

        const totalSessions = await this.db.query<{ count: number }>(
            `SELECT COUNT(*) as count FROM interview_sessions WHERE user_id = ?`,
            [userId],
        );

        const withCalibration = calibrationSessions[0]?.count || 0;
        const total = totalSessions[0]?.count || 0;
        const withoutCalibration = total - withCalibration;

        return {
            sessionsWithCalibration: withCalibration,
            sessionsWithoutCalibration: withoutCalibration,
            averageDeviationWithCalibration: 0.3, // 임시값
            averageDeviationWithoutCalibration: 0.5, // 임시값
            improvementPercentage: withCalibration > 0 ? 40 : 0, // 임시값
        };
    }

    // === 정규화 및 점수 계산 헬퍼 메서드들 ===

    private computeAudioNormalization(raw: AudioFeatures, baseline: AudioFeatures): AudioFeatures {
        return {
            ...raw,
            f0_mean: this.normalizeValue(raw.f0_mean || 0, baseline.f0_mean || 1),
            f0_std: this.normalizeValue(raw.f0_std || 0, baseline.f0_std || 1),
            rms_cv: this.normalizeValue(raw.rms_cv || 0, baseline.rms_cv || 1),
            jitter_like: this.normalizeValue(raw.jitter_like || 0, baseline.jitter_like || 1),
            shimmer_like: this.normalizeValue(raw.shimmer_like || 0, baseline.shimmer_like || 1),
            silence_ratio: this.normalizeValue(raw.silence_ratio || 0, baseline.silence_ratio || 1),
        };
    }

    private computeVisualNormalization(
        raw: VisualAggregateDto,
        baseline: VisualAggregateDto,
    ): VisualAggregateDto {
        return {
            ...raw,
            confidence_mean: this.normalizeValue(
                raw.confidence_mean || 0,
                baseline.confidence_mean || 1,
            ),
            smile_mean: this.normalizeValue(raw.smile_mean || 0, baseline.smile_mean || 1),
        };
    }

    private computeAudioDeviationScore(raw: AudioFeatures, baseline: AudioFeatures): number {
        const deviations = [
            Math.abs((raw.f0_mean || 0) - (baseline.f0_mean || 0)) /
                Math.max(baseline.f0_mean || 1, 1),
            Math.abs((raw.f0_std || 0) - (baseline.f0_std || 0)) /
                Math.max(baseline.f0_std || 1, 1),
            Math.abs((raw.rms_cv || 0) - (baseline.rms_cv || 0)) /
                Math.max(baseline.rms_cv || 0.1, 0.1),
            Math.abs((raw.jitter_like || 0) - (baseline.jitter_like || 0)) /
                Math.max(baseline.jitter_like || 0.01, 0.01),
            Math.abs((raw.shimmer_like || 0) - (baseline.shimmer_like || 0)) /
                Math.max(baseline.shimmer_like || 0.01, 0.01),
        ].filter((d) => isFinite(d) && d >= 0);

        return deviations.length > 0
            ? deviations.reduce((a, b) => a + b, 0) / deviations.length
            : 0;
    }

    private computeVisualDeviationScore(
        raw: VisualAggregateDto,
        baseline: VisualAggregateDto,
    ): number {
        const confidenceDev =
            Math.abs((raw.confidence_mean || 0) - (baseline.confidence_mean || 0)) /
            Math.max(baseline.confidence_mean || 1, 0.1);

        const smileDev =
            Math.abs((raw.smile_mean || 0) - (baseline.smile_mean || 0)) /
            Math.max(baseline.smile_mean || 1, 0.1);

        return (confidenceDev + smileDev) / 2;
    }

    private normalizeValue(value: number, baseline: number): number {
        if (baseline === 0) return value;
        return value / baseline;
    }

    private getDefaultAudioBaseline(): AudioFeatures {
        return {
            f0_mean: 150.0,
            f0_std: 30.0,
            rms_cv: 0.3,
            jitter_like: 0.02,
            shimmer_like: 0.05,
            silence_ratio: 0.1,
            rms_std: 0.15,
            sr: 16000,
        };
    }

    private getDefaultVisualBaseline(): VisualAggregateDto {
        return {
            confidence_mean: 0.8,
            smile_mean: 0.3,
            sample_count: 100,
            confidence_max: 0.9,
            smile_max: 0.5,
            presence_good: 80,
            presence_average: 15,
            presence_needs_improvement: 5,
            level_ok: 90,
            level_info: 8,
            level_warning: 2,
            level_critical: 0,
            started_at_ms: 0,
            ended_at_ms: 15000,
        } as VisualAggregateDto;
    }
}
