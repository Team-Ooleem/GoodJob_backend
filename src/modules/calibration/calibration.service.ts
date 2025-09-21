import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AudioFeatures } from '../audio-metrics/audio-metrics.service';
import { VisualAggregateDto } from '../metrics/dto/visual-aggregate.dto';
import { AnalysisClient } from '../audio-metrics/audio-metrics.client';

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
    constructor(
        private readonly db: DatabaseService,
        private readonly audioClient: AnalysisClient,
    ) {}

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
                calibrationText || '너무 맑고 초롱한 그 중 하나 별이여',
                durationMs || 0,
            ],
        );

        return this.getSessionCalibration(sessionId);
    }

    /**
     * 통합 캘리브레이션 처리(품질 게이팅 포함): 설정 페이지용
     */
    async calibrateSessionCombined(
        sessionId: string,
        userId: number,
        file: Express.Multer.File | null,
        visualDataRaw: any,
        durationMs: string | number,
    ): Promise<{
        ok: true;
        audioFeatures: Partial<AudioFeatures> | null;
        visualData: VisualAggregateDto | undefined;
        calibration: CalibrationResult | null;
    }> {
        const durMsNum = typeof durationMs === 'string' ? parseInt(durationMs) || 0 : durationMs;
        // if (!Number.isFinite(durMsNum) || durMsNum < 2000) {
        //     throw new BadRequestException('녹음 길이가 너무 짧습니다. 다시 진행해주세요.');
        // }

        const audioFeatures = file ? await this.audioClient.analyzeAudio(file) : null;

        const visualData: VisualAggregateDto | undefined =
            typeof visualDataRaw === 'string'
                ? (JSON.parse(visualDataRaw) as any as VisualAggregateDto)
                : (visualDataRaw as VisualAggregateDto | undefined);

        if (
            visualData &&
            typeof visualData.gaze_stability === 'number' &&
            Number.isFinite(visualData.gaze_stability) &&
            visualData.gaze_stability < 0.4
        ) {
            throw new BadRequestException('카메라를 좀 더 응시해주세요.');
        }
        // 헤드포즈 평균 절대각: |yaw| ≤ 25°, |pitch| ≤ 20° (프론트에서 평균 절대각을 보내므로 그대로 비교)
        const avgYaw = (visualData as any)?.avg_yaw_deg;
        if (typeof avgYaw === 'number' && Number.isFinite(avgYaw) && avgYaw > 25) {
            throw new BadRequestException(
                '헤드포즈(Yaw)가 크게 벗어났습니다(|yaw| ≤ 25°). 카메라를 정면으로 바라봐주세요.',
            );
        }
        const avgPitch = (visualData as any)?.avg_pitch_deg;
        if (typeof avgPitch === 'number' && Number.isFinite(avgPitch) && avgPitch > 20) {
            throw new BadRequestException(
                '헤드포즈(Pitch)가 크게 벗어났습니다(|pitch| ≤ 20°). 카메라를 정면으로 바라봐주세요.',
            );
        }
        if (
            audioFeatures &&
            typeof (audioFeatures as any).silence_ratio === 'number' &&
            Number.isFinite((audioFeatures as any).silence_ratio) &&
            (audioFeatures as any).silence_ratio > 0.6
        ) {
            throw new BadRequestException(
                '무성 구간 비율이 높습니다(silence_ratio ≤ 0.6). 다시 진행해주세요.',
            );
        }

        const result = await this.saveSessionCalibration(
            sessionId,
            userId,
            audioFeatures as any,
            visualData,
            '나는 핀토스를 부순다.',
            durMsNum,
        );

        return { ok: true, audioFeatures, visualData, calibration: result };
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
        // 표준화 기반 정규화(가능 시): (x - mu) / sigma
        const z = (x: number | null | undefined, mu: number | null | undefined, sigma: number) => {
            const xv = typeof x === 'number' && isFinite(x) ? x : 0;
            const muv = typeof mu === 'number' && isFinite(mu) ? mu : 0;
            const s = Math.max(0.05, sigma);
            return (xv - muv) / s;
        };

        const get = (v: any) => (typeof v === 'number' && isFinite(v) ? v : null);
        const sigma = (name: string, base: VisualAggregateDto) =>
            this.getScaleForVisualMetric(name, base);

        return {
            ...raw,
            // z-score로 표현(참고용). 원본 스케일이 필요한 경우 raw를 그대로 활용.
            confidence_mean: z(
                get(raw.confidence_mean),
                get(baseline.confidence_mean),
                sigma('confidence', baseline),
            ),
            smile_mean: z(get(raw.smile_mean), get(baseline.smile_mean), sigma('smile', baseline)),
            eye_contact_mean: z(
                get(raw.eye_contact_mean),
                get(baseline.eye_contact_mean),
                sigma('eye_contact', baseline),
            ),
            blink_mean: z(get(raw.blink_mean), get(baseline.blink_mean), sigma('blink', baseline)),
            gaze_stability: z(
                get(raw.gaze_stability),
                get(baseline.gaze_stability),
                sigma('gaze_stability', baseline),
            ),
            attention_mean: z(
                get(raw.attention_mean),
                get(baseline.attention_mean),
                sigma('attention', baseline),
            ),
            engagement_mean: z(
                get(raw.engagement_mean),
                get(baseline.engagement_mean),
                sigma('engagement', baseline),
            ),
            nervousness_mean: z(
                get(raw.nervousness_mean),
                get(baseline.nervousness_mean),
                sigma('nervousness', baseline),
            ),
        } as VisualAggregateDto;
    }

    private computeAudioDeviationScore(raw: AudioFeatures, baseline: AudioFeatures): number {
        // 표준화 헬퍼
        const anyBase = baseline as any;
        const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
        const safeNum = (x: any, d = 0) => (typeof x === 'number' && isFinite(x) ? x : d);
        const z = (x: number, mu: number, sigma: number) => {
            const s = Math.max(1e-8, sigma);
            return (x - mu) / s;
        };
        const MAD_TO_SIGMA = 1.4826;
        const pickSigma = (name: string, fallback: number): number => {
            // 우선순위: *_sigma_robust → *_std → *_mad×1.4826 → fallback
            const robust = safeNum(anyBase[`${name}_sigma_robust`], NaN);
            if (isFinite(robust) && robust > 0) return clamp(robust, 1e-4, 10);
            const stdv = safeNum(anyBase[`${name}_std`], NaN);
            if (isFinite(stdv) && stdv > 0) return clamp(stdv, 1e-4, 10);
            const madv = safeNum(anyBase[`${name}_mad`], NaN);
            if (isFinite(madv) && madv > 0) return clamp(madv * MAD_TO_SIGMA, 1e-4, 10);
            return fallback;
        };

        // 1) 톤 오프셋(평균 F0) – 세미톤 차이 기반 (mu=0)
        const f0Mean = safeNum(raw.f0_mean, 0);
        const f0Ref = safeNum(anyBase.f0_median_hz ?? anyBase.f0_mean, 0) || 0;
        const stShift = f0Ref > 0 ? 12 * Math.log2((f0Mean + 1e-8) / (f0Ref + 1e-8)) : 0;
        const sigSt = Math.max(0.05, safeNum(anyBase.f0_std_semitone, 0.2));
        const zTone = z(stShift, 0, sigSt);

        // 2) 톤 안정성 – f0_std_semitone (mu=baseline.f0_std_semitone, sigma≈same scale)
        const rawStStd = safeNum((raw as any).f0_std_semitone, 0);
        const baseStStd = safeNum(anyBase.f0_std_semitone, 0);
        const sigStStd = Math.max(0.05, baseStStd || 0.2);
        const zToneStab = z(rawStStd, baseStStd, sigStStd);

        // 3) 에너지 변동 – rms_cv (mu=baseline.rms_cv, sigma: rms_cv_std or db std proxy)
        const rmsCv = safeNum(raw.rms_cv, 0);
        const baseRmsCv = safeNum(anyBase.rms_cv, 0);
        const sigRmsCv = Math.max(
            0.05,
            pickSigma('rms_cv', Math.max(0.08, safeNum(anyBase.rms_db_std_voiced, 0.12))),
        );
        const zRms = z(rmsCv, baseRmsCv, sigRmsCv);

        // 4) jitter/shimmer (robust sigma 선호)
        const jitter = safeNum(raw.jitter_like, 0);
        const baseJitter = safeNum(anyBase.jitter_like, 0);
        const sigJitter = Math.max(
            1e-4,
            pickSigma('jitter_like', Math.max(0.01, baseJitter * 0.5 || 0.015)),
        );
        const zJitter = z(jitter, baseJitter, sigJitter);

        const shimmer = safeNum(raw.shimmer_like, 0);
        const baseShimmer = safeNum(anyBase.shimmer_like, 0);
        const sigShimmer = Math.max(
            1e-4,
            pickSigma('shimmer_like', Math.max(0.02, baseShimmer * 0.5 || 0.03)),
        );
        const zShimmer = z(shimmer, baseShimmer, sigShimmer);

        // 5) 발화 비율 – silence_ratio (mu=baseline, sigma fallback)
        const sil = safeNum(raw.silence_ratio, 0);
        const baseSil = safeNum(anyBase.silence_ratio, 0.1);
        const sigSil = Math.max(0.05, pickSigma('silence_ratio', 0.1));
        const zSil = z(sil, baseSil, sigSil);

        // 가중 RMS 합성 (0~1로 스케일: z=2를 크게 벗어남으로 간주)
        const terms: Array<{ w: number; z: number }> = [
            { w: 0.15, z: zTone },
            { w: 0.2, z: zToneStab },
            { w: 0.15, z: zRms },
            { w: 0.25, z: zJitter },
            { w: 0.15, z: zShimmer },
            { w: 0.1, z: zSil },
        ].filter((t) => isFinite(t.z));
        const wSum = terms.reduce((a, b) => a + b.w, 0) || 1;
        const rms = Math.sqrt(terms.reduce((a, b) => a + b.w * b.z * b.z, 0) / wSum);
        return clamp(rms / 2, 0, 1);
    }

    private computeVisualDeviationScore(
        raw: VisualAggregateDto,
        baseline: VisualAggregateDto,
    ): number {
        // 가중 RMS(표준화 편차)로 편차 점수 계산 (0~1 범위로 매핑)
        const get = (v: any) => (typeof v === 'number' && isFinite(v) ? v : null);
        const z = (x: number | null, mu: number | null, sigma: number) => {
            const xv = typeof x === 'number' && isFinite(x) ? x : 0;
            const muv = typeof mu === 'number' && isFinite(mu) ? mu : 0;
            const s = Math.max(0.05, sigma);
            return (xv - muv) / s;
        };
        const sigma = (name: string, base: VisualAggregateDto) =>
            this.getScaleForVisualMetric(name, base);

        const entries: Array<{ w: number; z: number }> = [];
        const pushZ = (
            name: string,
            w: number,
            x: number | null | undefined,
            mu: number | null | undefined,
        ) => {
            const zi = z(get(x), get(mu), sigma(name, baseline));
            if (isFinite(zi)) entries.push({ w, z: zi });
        };

        // 요청 항목: 시선, 깜빡임, 미소, attention/engagement/nervousness, gaze_stability
        pushZ('eye_contact', 0.2, raw.eye_contact_mean, baseline.eye_contact_mean);
        pushZ('blink', 0.15, raw.blink_mean, baseline.blink_mean);
        pushZ('smile', 0.15, raw.smile_mean, baseline.smile_mean);
        pushZ('attention', 0.15, raw.attention_mean, baseline.attention_mean);
        pushZ('engagement', 0.15, raw.engagement_mean, baseline.engagement_mean);
        pushZ('nervousness', 0.1, raw.nervousness_mean, baseline.nervousness_mean);
        pushZ('gaze_stability', 0.1, raw.gaze_stability, baseline.gaze_stability);

        if (entries.length === 0) return 0;
        const wSum = entries.reduce((a, b) => a + b.w, 0) || 1;
        const rms = Math.sqrt(entries.reduce((acc, e) => acc + e.w * e.z * e.z, 0) / wSum);
        // z 2.0을 최대 편차로 보고 0~1로 스케일
        const dev01 = Math.max(0, Math.min(1, rms / 2));
        return dev01;
    }

    private normalizeValue(value: number, baseline: number): number {
        if (baseline === 0) return value;
        return value / baseline;
    }

    // 시각 지표 표준화 스케일(표준편차 또는 유효 범위 근사).
    // baseline에 *_std 또는 *_mad가 있으면 우선 사용하고, 없으면 보수적 기본값으로 폴백한다.
    private getScaleForVisualMetric(name: string, base: VisualAggregateDto): number {
        const anyBase = base as any;
        const stdKey = `${name}_std`;
        const madKey = `${name}_mad`;

        const hasStd = typeof anyBase?.[stdKey] === 'number' && isFinite(anyBase[stdKey]);
        const hasMad = typeof anyBase?.[madKey] === 'number' && isFinite(anyBase[madKey]);
        const MAD_TO_SIGMA = 1.4826;

        let sigma: number | null = null;
        if (hasStd) {
            sigma = Number(anyBase[stdKey]);
        } else if (hasMad) {
            sigma = Math.abs(Number(anyBase[madKey])) * MAD_TO_SIGMA;
        }

        // 기본 스케일(0~1 bounded 지표 기준 경험값)
        const fallback: Record<string, number> = {
            eye_contact: 0.15,
            blink: 0.08,
            smile: 0.2,
            attention: 0.2,
            engagement: 0.2,
            nervousness: 0.2,
            gaze_stability: 0.15,
            confidence: 0.2,
        };

        // 우선순위: std → mad → fallback
        const chosen = sigma ?? fallback[name] ?? 0.2;
        // 바닥/상한으로 안정화(과도한 스케일/극소값 방지)
        return Math.max(0.05, Math.min(0.6, chosen));
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
