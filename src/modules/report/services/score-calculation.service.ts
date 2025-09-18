import { Injectable } from '@nestjs/common';
import { AudioSummary } from './audio-analysis.service';
import { VisualSummary } from './visual-analysis.service';
import { CalibrationService } from '../../calibration/calibration.service';

export type ExpressionIndices = {
    confidence: number;
    clarity: number;
    engagement: number;
    composure: number;
    professionalism: number;
    consistency: number;
    reliabilityWeight?: number;
};

export type CalibrationInfo = {
    audio_calibrated: boolean;
    visual_calibrated: boolean;
    calibration_applied: boolean;
};

@Injectable()
export class ScoreCalculationService {
    constructor(private readonly calibration: CalibrationService) {}

    // 캘리브레이션 정보 조회
    async getCalibrationInfo(sessionId: string): Promise<CalibrationInfo> {
        const calibration = await this.calibration.getSessionCalibration(sessionId);
        return {
            audio_calibrated: !!calibration?.audioBaseline,
            visual_calibrated: !!calibration?.visualBaseline,
            calibration_applied: !!calibration?.audioBaseline || !!calibration?.visualBaseline,
        };
    }

    // 표현 지표 40점 계산
    computeExpression40(audio_summary: AudioSummary, visual_summary: VisualSummary): number {
        const tone = Math.max(0, Math.min(100, audio_summary.toneScore));
        const vibrato = Math.max(0, Math.min(100, audio_summary.vibratoScore));
        const pace = Math.max(0, Math.min(100, audio_summary.paceScore));
        const ov: any = visual_summary.overall || {};
        const confidencePct = visual_summary.confidenceScore;
        const eyePct = this.toPct01(ov?.eye_contact_mean);
        const gazePct = this.toPct01(ov?.gaze_stability);
        const attentionPct = this.toPct01(ov?.attention_mean);
        const engagementPct = this.toPct01(ov?.engagement_mean);
        const blinkMean =
            typeof ov?.blink_mean === 'number' ? Math.max(0, Math.min(1, ov.blink_mean)) : 0.25;
        const nervousPct = this.toPct01(ov?.nervousness_mean);
        const behaviorPct = visual_summary.behaviorScore;
        const alertPct = visual_summary.alertRatioPercent;

        const visualC = 0.6 * confidencePct + 0.25 * eyePct + 0.15 * gazePct;
        const audioC = 0.6 * tone + 0.4 * vibrato;
        const confidenceIndex = Math.max(0, Math.min(100, 0.6 * visualC + 0.4 * audioC));

        const clarityIndex = Math.max(0, Math.min(100, 0.5 * vibrato + 0.3 * tone + 0.2 * pace));

        const visualE = 0.5 * attentionPct + 0.25 * eyePct + 0.25 * engagementPct;
        const audioE = pace;
        const engagementIndex = Math.max(0, Math.min(100, 0.7 * visualE + 0.3 * audioE));

        const blinkScore01 = 1 - Math.min(1, Math.abs(blinkMean - 0.25) / 0.25);
        const blinkPct = blinkScore01 * 100;
        const visualCalm = 0.7 * (100 - nervousPct) + 0.3 * blinkPct;
        const audioCalm = 0.7 * vibrato + 0.3 * pace;
        const composureIndex = Math.max(0, Math.min(100, 0.5 * visualCalm + 0.5 * audioCalm));

        const visualP = 0.6 * behaviorPct + 0.25 * (100 - alertPct) + 0.15 * gazePct;
        const audioP = tone;
        const professionalismRaw = Math.max(0, Math.min(100, 0.7 * visualP + 0.3 * audioP));

        const audioScores = (audio_summary.questionScores || []).map((x) => x.score);
        const visualScores = (visual_summary.questionScores || []).map((x) => x.score);
        const std = (arr: number[]) => {
            if (!arr || arr.length < 2) return NaN;
            const m = arr.reduce((a, b) => a + b, 0) / arr.length;
            const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1);
            return Math.sqrt(v);
        };
        const stdA = std(audioScores);
        const stdV = std(visualScores);
        const valids = [stdA, stdV].filter((x) => isFinite(x));
        const stdMix = valids.length ? valids.reduce((a, b) => a + b, 0) / valids.length : NaN;
        const consistency = isFinite(stdMix)
            ? Math.max(0, Math.min(100, 100 - Math.max(0, Math.min(100, (stdMix / 25) * 100))))
            : 50;

        const covA =
            typeof audio_summary.calibrationCoverage === 'number'
                ? audio_summary.calibrationCoverage
                : 0;
        const covV =
            typeof visual_summary.calibrationCoverage === 'number'
                ? visual_summary.calibrationCoverage
                : 0;
        const reliabilityWeight = 0.75 + 0.25 * ((covA + covV) / 2);

        const alertPenalty = Math.min(6, alertPct * 0.06);
        const points = (x: number, cap: number) =>
            Math.round((Math.max(0, Math.min(100, x)) / 100) * cap);
        const confidencePts = points(confidenceIndex, 8);
        const clarityPts = points(clarityIndex, 8);
        const engagementPts = points(engagementIndex, 8);
        const composurePts = points(composureIndex, 6);
        const professionalismPts = Math.max(
            0,
            points(professionalismRaw, 6) - Math.round(alertPenalty),
        );
        const consistencyCap = Math.max(audioScores.length, visualScores.length) < 3 ? 2 : 4;
        const consistencyPts = points(consistency, consistencyCap);
        const base40 =
            confidencePts +
            clarityPts +
            engagementPts +
            composurePts +
            professionalismPts +
            consistencyPts;
        const expression40 = Math.round(Math.max(0, Math.min(40, base40 * reliabilityWeight)));

        return expression40;
    }

    // 표현 지수 계산
    computeExpressionIndices(
        audio_summary: AudioSummary,
        visual_summary: VisualSummary,
    ): ExpressionIndices {
        const tone = Math.max(0, Math.min(100, audio_summary.toneScore));
        const vibrato = Math.max(0, Math.min(100, audio_summary.vibratoScore));
        const pace = Math.max(0, Math.min(100, audio_summary.paceScore));
        const ov: any = visual_summary.overall || {};
        const confidencePct = visual_summary.confidenceScore;
        const eyePct = this.toPct01(ov?.eye_contact_mean);
        const gazePct = this.toPct01(ov?.gaze_stability);
        const attentionPct = this.toPct01(ov?.attention_mean);
        const engagementPct = this.toPct01(ov?.engagement_mean);
        const blinkMean =
            typeof ov?.blink_mean === 'number' ? Math.max(0, Math.min(1, ov.blink_mean)) : 0.25;
        const nervousPct = this.toPct01(ov?.nervousness_mean);
        const behaviorPct = visual_summary.behaviorScore;
        const alertPct = visual_summary.alertRatioPercent;

        const visualC = 0.6 * confidencePct + 0.25 * eyePct + 0.15 * gazePct;
        const audioC = 0.6 * tone + 0.4 * vibrato;
        const confidenceIndex = Math.max(0, Math.min(100, 0.6 * visualC + 0.4 * audioC));

        const clarityIndex = Math.max(0, Math.min(100, 0.5 * vibrato + 0.3 * tone + 0.2 * pace));

        const visualE = 0.5 * attentionPct + 0.25 * eyePct + 0.25 * engagementPct;
        const audioE = pace;
        const engagementIndex = Math.max(0, Math.min(100, 0.7 * visualE + 0.3 * audioE));

        const blinkScore01 = 1 - Math.min(1, Math.abs(blinkMean - 0.25) / 0.25);
        const blinkPct = blinkScore01 * 100;
        const visualCalm = 0.7 * (100 - nervousPct) + 0.3 * blinkPct;
        const audioCalm = 0.7 * vibrato + 0.3 * pace;
        const composureIndex = Math.max(0, Math.min(100, 0.5 * visualCalm + 0.5 * audioCalm));

        const visualP = 0.6 * behaviorPct + 0.25 * (100 - alertPct) + 0.15 * gazePct;
        const audioP = tone;
        const professionalismRaw = Math.max(0, Math.min(100, 0.7 * visualP + 0.3 * audioP));

        const audioScores = (audio_summary.questionScores || []).map((x) => x.score);
        const visualScores = (visual_summary.questionScores || []).map((x) => x.score);
        const std = (arr: number[]) => {
            if (!arr || arr.length < 2) return NaN;
            const m = arr.reduce((a, b) => a + b, 0) / arr.length;
            const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1);
            return Math.sqrt(v);
        };
        const stdA = std(audioScores);
        const stdV = std(visualScores);
        const valids = [stdA, stdV].filter((x) => isFinite(x));
        const stdMix = valids.length ? valids.reduce((a, b) => a + b, 0) / valids.length : NaN;
        const consistency = isFinite(stdMix)
            ? Math.max(0, Math.min(100, 100 - Math.max(0, Math.min(100, (stdMix / 25) * 100))))
            : 50;

        const covA =
            typeof audio_summary.calibrationCoverage === 'number'
                ? audio_summary.calibrationCoverage
                : 0;
        const covV =
            typeof visual_summary.calibrationCoverage === 'number'
                ? visual_summary.calibrationCoverage
                : 0;
        const reliabilityWeight = 0.75 + 0.25 * ((covA + covV) / 2);

        return {
            confidence: Math.round(confidenceIndex),
            clarity: Math.round(clarityIndex),
            engagement: Math.round(engagementIndex),
            composure: Math.round(composureIndex),
            professionalism: Math.round(professionalismRaw),
            consistency: Math.round(consistency),
            reliabilityWeight: Number(reliabilityWeight.toFixed(3)),
        };
    }

    // 헬퍼 메서드들
    private clamp(x: number, a: number, b: number) {
        return Math.max(a, Math.min(b, x));
    }

    private toPct01(x: number | null | undefined) {
        if (x == null || !isFinite(x)) return 0;
        return this.clamp(x, 0, 1) * 100;
    }
}
