import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Param,
    Post,
    UploadedFile,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AudioMetricsService } from './audio-metrics.service';
import type { AudioFeatures } from './audio-metrics.service';
import { AnalysisClient } from './audio-metrics.client';
import { CalibrationService } from '../calibration/calibration.service';

@Controller('audio-metrics')
export class AudioMetricsController {
    constructor(
        private readonly svc: AudioMetricsService,
        private readonly client: AnalysisClient,
        private readonly calibrationSvc: CalibrationService,
    ) {}

    /**
     * 레거시: 직접 특성 업서트 (캘리브레이션 미적용)
     */
    @Post(':sessionId/:questionId')
    async upsert(
        @Param('sessionId') sessionId: string,
        @Param('questionId') questionId: string,
        @Body() body: AudioFeatures,
    ) {
        await this.svc.upsertQuestionMetrics(sessionId, questionId, body);
        return { ok: true };
    }

    @Get(':sessionId/overall')
    async overall(@Param('sessionId') sessionId: string) {
        const overall = await this.svc.getSessionAudioOverall(sessionId);
        return { ok: true, overall };
    }

    @Get(':sessionId')
    async perQuestion(
        @Param('sessionId') sessionId: string,
    ): Promise<{ ok: boolean; rows: any[] }> {
        const rows = await this.svc.getPerQuestion(sessionId);
        return { ok: true, rows };
    }

    /**
     * 면접 중 음성 분석 + 캘리브레이션 적용
     */
    @Post(':sessionId/:questionId/analyze')
    @UseInterceptors(FileInterceptor('file'))
    async analyzeUpload(
        @Param('sessionId') sessionId: string,
        @Param('questionId') questionId: string,
        @UploadedFile() file: Express.Multer.File,
    ) {
        if (!file) throw new BadRequestException('file is required');

        // AI 서버로 음성 분석
        const features = await this.client.analyzeAudio(file);

        // 원본 특성 저장
        await this.svc.upsertQuestionMetrics(sessionId, questionId, features as AudioFeatures);

        // 캘리브레이션 기반 정규화 수행
        try {
            const normalizedResult = await this.calibrationSvc.normalizeAudioFeatures(
                sessionId,
                features as AudioFeatures,
            );

            if (
                normalizedResult.calibrationApplied &&
                normalizedResult.deviationScore !== undefined
            ) {
                // 편차 점수를 0-100 스케일로 변환 (낮을수록 좋음 → 높을수록 좋음)
                const normalizedScore = Math.max(
                    0,
                    Math.min(100, 100 - normalizedResult.deviationScore * 100),
                );

                await this.calibrationSvc.saveNormalizedAudioScore(
                    sessionId,
                    questionId,
                    normalizedScore,
                    true,
                );
            } else {
                // 캘리브레이션이 없는 경우 기본 점수 계산
                const defaultScore = this.calculateDefaultAudioScore(features as AudioFeatures);
                await this.calibrationSvc.saveNormalizedAudioScore(
                    sessionId,
                    questionId,
                    defaultScore,
                    false,
                );
            }
        } catch (error) {
            console.warn('음성 정규화 처리 실패:', error);
            // 정규화 실패해도 원본 분석은 유지
        }

        return { ok: true, features };
    }

    /**
     * 캘리브레이션용 음성 분석 (DB 저장 없음)
     */
    @Post('calibration/analyze')
    @UseInterceptors(FileInterceptor('file'))
    async analyzeCalibration(@UploadedFile() file: Express.Multer.File) {
        if (!file) throw new BadRequestException('file is required');
        const features = await this.client.analyzeAudio(file);
        return { ok: true, features };
    }

    /**
     * 문항별 정규화 점수 조회
     */
    @Get(':sessionId/:questionId/normalized')
    async getNormalizedScore(
        @Param('sessionId') sessionId: string,
        @Param('questionId') questionId: string,
    ) {
        const normalizedScore = await this.svc.getNormalizedAudioScore(sessionId, questionId);
        return {
            ok: true,
            normalizedScore: normalizedScore?.score,
            calibrationApplied: normalizedScore?.calibrationApplied || false,
        };
    }

    /**
     * 기본 음성 점수 계산 (캘리브레이션 없을 때)
     */
    private calculateDefaultAudioScore(features: AudioFeatures): number {
        let score = 50; // 기본 점수

        // 기본 범위값들 (일반적인 음성 특성)
        const ranges = {
            f0_mean: { ideal: 150, tolerance: 50 }, // 150 ± 50 Hz
            f0_std: { ideal: 30, tolerance: 20 }, // 30 ± 20 Hz
            rms_cv: { ideal: 0.3, tolerance: 0.2 }, // 0.3 ± 0.2
            jitter_like: { max: 0.05 }, // 0.05 이하가 좋음
            shimmer_like: { max: 0.1 }, // 0.1 이하가 좋음
            silence_ratio: { ideal: 0.1, tolerance: 0.1 }, // 10% ± 10%
        };

        // F0 (기본 주파수) 안정성 점수 (0~20점)
        const f0Mean = features.f0_mean ?? 150;
        const f0Stability = Math.max(
            0,
            20 - (Math.abs(f0Mean - ranges.f0_mean.ideal) / ranges.f0_mean.tolerance) * 20,
        );
        score += f0Stability;

        // F0 변화량 적절성 점수 (0~15점)
        const f0Std = features.f0_std ?? 30;
        const f0Variation = Math.max(
            0,
            15 - (Math.abs(f0Std - ranges.f0_std.ideal) / ranges.f0_std.tolerance) * 15,
        );
        score += f0Variation;

        // 음성 에너지 일관성 점수 (0~15점)
        const rmsCv = features.rms_cv ?? 0.3;
        const energyConsistency = Math.max(
            0,
            15 - (Math.abs(rmsCv - ranges.rms_cv.ideal) / ranges.rms_cv.tolerance) * 15,
        );
        score += energyConsistency;

        // Jitter (음성 떨림) 점수 (0~10점, 낮을수록 좋음)
        const jitterLike = features.jitter_like ?? 0.02;
        const jitterScore = Math.max(0, 10 - (jitterLike / ranges.jitter_like.max) * 10);
        score += jitterScore;

        // Shimmer (음성 진폭 변화) 점수 (0~10점, 낮을수록 좋음)
        const shimmerLike = features.shimmer_like ?? 0.05;
        const shimmerScore = Math.max(0, 10 - (shimmerLike / ranges.shimmer_like.max) * 10);
        score += shimmerScore;

        // 침묵 비율 적절성 점수 (0~10점)
        const silenceRatio = features.silence_ratio ?? 0.1;
        const silenceScore = Math.max(
            0,
            10 -
                (Math.abs(silenceRatio - ranges.silence_ratio.ideal) /
                    ranges.silence_ratio.tolerance) *
                    10,
        );
        score += silenceScore;

        // 특별 보정
        if (silenceRatio > 0.5) {
            score -= 20; // 침묵이 너무 많으면 감점
        }
        if (jitterLike > 0.1 || shimmerLike > 0.2) {
            score -= 15; // 음성 품질이 너무 나쁘면 감점
        }

        return Math.max(0, Math.min(100, Math.round(score)));
    }
}
