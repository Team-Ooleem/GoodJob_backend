import { Injectable } from '@nestjs/common';
import { MetricsService, SessionVisualAggregate } from '../metrics/metrics.service';
import { AudioMetricsService, AudioFeatures } from '../audio-metrics/audio-metrics.service';
import { CalibrationService } from '../calibration/calibration.service';
import { DatabaseService } from '../../database/database.service';
import { AnalyzeReportDto } from './dto/analyze-report.dto';
import { OpenAIService } from '@/modules/openai/openai.service';

export type InterviewAnalysisResult = {
    overall_score: number; // 0~100 (내용30 + 맥락30 + 표현40)
    detailed_scores: {
        content30: number;
        context30: number;
        expression40: number;
    };
    expression_indices: {
        confidence: number;
        clarity: number;
        engagement: number;
        composure: number;
        professionalism: number;
        consistency: number;
        reliabilityWeight?: number;
    };
    strengths?: string[];
    improvements?: string[];
    detailed_feedback?: Record<string, { score: number; feedback: string; question?: string }>;
    overall_evaluation?: string;
    recommendations?: string[];
    calibration_info?: {
        audio_calibrated: boolean;
        visual_calibrated: boolean;
        calibration_applied: boolean;
    };
    // 종합 음성 지표 및 문항별 정규화 점수 (프론트 표시용)
    audio_summary?: {
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
    // 종합 영상 지표 및 문항별 정규화 점수 (프론트 표시용)
    visual_summary?: {
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
    // ===== NEW: 텍스트(내용/맥락) LLM 집계 요약 =====
    text_analysis_summary?: {
        content_avg100: number; // 문항별 content_score 평균(0-100)
        context_avg100: number; // 문항별 context_score 평균(0-100)
        overall_llm10: number; // LLM 텍스트 종합(0-10)
        top_reasons?: string[]; // 근거 bullet 상위(중복 제거)
        top_improvements?: string[]; // 개선 팁 상위(중복 제거)
    };
    // 프론트 하이라이트용 근거 링크(상위 N개)
    evidence_links?: Array<{
        answer_span: string;
        resume_ref?: string;
        similarity?: number;
        explanation?: string;
    }>;
    // ===== NEW: 이력서 요약 기반 1분 자기소개 대본 =====
    self_intro_script?: string;
};

// ===== NEW: 문항별 텍스트 분석 로우 타입 =====
type ContentAnalysisRow = {
    content_score: number; // 0~100
    reasoning?: string[];
    improvements?: string[];
    star?: { situation?: string; task?: string; action?: string; result?: string };
};
type ContextAnalysisRow = {
    context_score: number; // 0~100
    links?: Array<{
        answer_span: string;
        resume_ref?: string;
        similarity?: number;
        explanation?: string;
    }>;
    consistency?: { contradiction: boolean; notes?: string };
};

@Injectable()
export class ReportService {
    constructor(
        private readonly metrics: MetricsService,
        private readonly audio: AudioMetricsService,
        private readonly calibration: CalibrationService,
        private readonly db: DatabaseService,
        private readonly openai: OpenAIService,
    ) {}

    // ===== NEW: DB에서 문항별 Content/Context 분석 불러오기 =====
    private async getPerQuestionTextAnalyses(
        sessionId: string,
    ): Promise<
        Array<{ questionId: string; content?: ContentAnalysisRow; context?: ContextAnalysisRow }>
    > {
        // questions와 조인하여 order_no 기준 정렬, 없으면 question_id 정렬 폴백
        const rows = await this.db.query<any>(
            `SELECT iaa.question_id, iaa.content_analysis_json, iaa.context_analysis_json, q.order_no
               FROM interview_answer_analyses iaa
          LEFT JOIN questions q
                 ON q.session_id = iaa.session_id AND q.question_id = iaa.question_id
              WHERE iaa.session_id = ?
           ORDER BY q.order_no ASC, iaa.question_id ASC`,
            [sessionId],
        );
        const out: Array<{
            questionId: string;
            content?: ContentAnalysisRow;
            context?: ContextAnalysisRow;
        }> = [];
        for (const r of rows) {
            let c: ContentAnalysisRow | undefined;
            let k: ContextAnalysisRow | undefined;
            try {
                if (r.content_analysis_json)
                    c =
                        typeof r.content_analysis_json === 'string'
                            ? JSON.parse(r.content_analysis_json)
                            : r.content_analysis_json;
            } catch {}
            try {
                if (r.context_analysis_json)
                    k =
                        typeof r.context_analysis_json === 'string'
                            ? JSON.parse(r.context_analysis_json)
                            : r.context_analysis_json;
            } catch {}
            out.push({ questionId: String(r.question_id), content: c, context: k });
        }
        return out;
    }

    // ===== NEW: 텍스트 분석 집계 =====
    private aggregateTextAnalyses(
        items: Array<{
            questionId: string;
            content?: ContentAnalysisRow;
            context?: ContextAnalysisRow;
        }>,
    ) {
        const contentScores: number[] = [];
        const contextScores: number[] = [];
        const reasons: string[] = [];
        const improvements: string[] = [];
        const links: Array<{
            answer_span: string;
            resume_ref?: string;
            similarity?: number;
            explanation?: string;
        }> = [];
        let hasContradiction = false;

        for (const it of items) {
            if (it.content?.content_score != null && isFinite(it.content.content_score)) {
                contentScores.push(Math.max(0, Math.min(100, it.content.content_score)));
            }
            if (it.content?.reasoning?.length) reasons.push(...it.content.reasoning);
            if (it.content?.improvements?.length) improvements.push(...it.content.improvements);

            if (it.context?.context_score != null && isFinite(it.context.context_score)) {
                contextScores.push(Math.max(0, Math.min(100, it.context.context_score)));
            }
            if (Array.isArray(it.context?.links)) links.push(...(it.context!.links as any));
            if (it.context?.consistency?.contradiction) hasContradiction = true;
        }

        const avg = (arr: number[]) =>
            arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        const content_avg100 = Math.round(avg(contentScores));
        const context_avg100 = Math.round(avg(contextScores));
        const overall_llm10 = Math.round((content_avg100 * 0.6 + context_avg100 * 0.4) / 10);

        const uniq = (xs: string[], limit = 6) => {
            const seen = new Set<string>();
            const out: string[] = [];
            for (const x of xs) {
                const k = (x || '').trim();
                if (!k) continue;
                if (!seen.has(k)) {
                    seen.add(k);
                    out.push(k);
                    if (out.length >= limit) break;
                }
            }
            return out;
        };

        const evidence_links = links
            .filter((l) => l && (l as any).answer_span)
            .sort((a, b) => (b?.similarity ?? 0) - (a?.similarity ?? 0))
            .slice(0, 10);

        return {
            content_avg100,
            context_avg100,
            overall_llm10,
            top_reasons: uniq(reasons, 6),
            top_improvements: uniq(improvements, 6),
            evidence_links,
            contradiction: hasContradiction,
        };
    }

    // ===== NEW: 세션 사용자 이력서 요약 조회 =====
    private async getResumeSummaryForSession(sessionId: string): Promise<string | null> {
        try {
            const sess = await this.db.queryOne<any>(
                `SELECT user_id FROM interview_sessions WHERE session_id = ?`,
                [sessionId],
            );
            const userId = sess?.user_id as number | undefined;
            if (!userId) return null;

            const bySummary = await this.db.queryOne<any>(
                `SELECT summary FROM resume_files 
                 WHERE user_id = ? AND summary IS NOT NULL AND CHAR_LENGTH(summary) >= 10
                 ORDER BY created_at DESC LIMIT 1`,
                [userId],
            );
            if (bySummary?.summary && String(bySummary.summary).trim().length >= 10) {
                return String(bySummary.summary).trim();
            }

            const byText = await this.db.queryOne<any>(
                `SELECT text_content FROM resume_files 
                 WHERE user_id = ? AND text_content IS NOT NULL AND CHAR_LENGTH(text_content) >= 50
                 ORDER BY created_at DESC LIMIT 1`,
                [userId],
            );
            if (byText?.text_content) {
                return String(byText.text_content).trim();
            }
            return null;
        } catch {
            return null;
        }
    }

    // ===== NEW: OpenAI 기반 1분 자기소개 대본 생성 =====
    private async generateSelfIntroWithOpenAI(summary: string): Promise<string> {
        const sys =
            '너는 지원자의 이력서 요약을 토대로 1분 자기소개 대본을 작성하는 코치다. ' +
            '한국어 정중체 1인칭으로, 불릿 없이 자연스러운 단락 문장만 출력한다. ' +
            '출력은 순수 본문만, JSON/머리말/주석 금지.';
        const user =
            `이력서 요약:\n${summary}\n\n` +
            '요구사항:\n' +
            '- 분량: 한국어 250~700자 내외(약 45~60초)\n' +
            '- 구성: 인사→강점/핵심역량→정량 성과(있으면)→기술/도메인 역량→입사 후 기여→맺음말\n' +
            '- 톤: 명료하고 간결, 구체적 수치 포함 선호, 회사명/직무명 특정 금지\n' +
            '- 출력: 본문만. 불릿/제목/따옴표/코드블록 금지';

        const content = await this.openai.chat([
            { role: 'system', content: sys },
            { role: 'user', content: user },
        ]);
        const cleaned = String(content || '')
            .replace(/^\s*```[\s\S]*?```\s*$/g, '')
            .replace(/^\s*"|"\s*$/g, '')
            .replace(/^[\s\uFEFF\u200B]+|[\s\uFEFF\u200B]+$/g, '')
            .trim();
        return cleaned;
    }

    // ===== Helpers =====
    private clamp(x: number, a: number, b: number) {
        return Math.max(a, Math.min(b, x));
    }
    private toPct01(x: number | null | undefined) {
        if (x == null || !isFinite(x)) return 0;
        return this.clamp(x, 0, 1) * 100;
    }

    // Legacy helper stubs kept for compatibility (not used in new scoring)
    private countConnectors(_text: string) {
        return 0;
    }
    private wordStats(_text: string) {
        return { total: 0, unique: 0, longWords: 0, digitCount: 0, connectors: 0 } as any;
    }
    private scale01(_x: number, _a: number, _b: number) {
        return 0;
    }

    // ===== NEW: Calibration-aware scoring =====

    /**
     * 캘리브레이션 기반 음성 점수 계산
     */
    private async getAudioImpressionScore(sessionId: string): Promise<number> {
        const normalizedScores = await this.audio.getSessionNormalizedScores(sessionId);

        if (normalizedScores.questionScores.length === 0) {
            // 폴백: 기존 절대 기준 방식
            const audioAll = await this.audio.getSessionAudioOverall(sessionId);
            return this.getFallbackAudioScore(audioAll);
        }

        const avgScore = normalizedScores.averageScore;
        const calibrationCoverage = normalizedScores.calibrationCoverage;

        // 캘리브레이션 적용 비율에 따른 신뢰도 가중치
        const reliabilityWeight = 0.7 + calibrationCoverage * 0.3;

        // 정규화 점수를 10점 만점으로 스케일링
        return Math.round((avgScore / 100) * 10 * reliabilityWeight);
    }

    /**
     * 종합 음성 지표 계산(캘리브레이션 고려) + 서브점수 제공
     */
    private async getAudioSummary(
        sessionId: string,
    ): Promise<NonNullable<InterviewAnalysisResult['audio_summary']>> {
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

    /**
     * 캘리브레이션 기반 영상 점수 계산
     */
    private async getVisualImpressionScore(sessionId: string): Promise<number> {
        // 세션 집계에서 정규화 점수들 조회
        const questionIds = await this.getQuestionIds(sessionId);
        const normalizedScores: number[] = [];
        let calibratedCount = 0;

        for (const qid of questionIds) {
            const scoreResult = await this.metrics.getNormalizedVisualScore(sessionId, qid);
            if (scoreResult) {
                normalizedScores.push(scoreResult.score);
                if (scoreResult.calibrationApplied) calibratedCount++;
            }
        }

        if (normalizedScores.length === 0) {
            // 폴백: 기존 절대 기준 방식
            const visualAll = (await this.metrics.getSessionAggregate(sessionId))?.overall;
            return this.getFallbackVisualScore(visualAll);
        }

        const avgScore = normalizedScores.reduce((a, b) => a + b, 0) / normalizedScores.length;
        const calibrationCoverage = calibratedCount / normalizedScores.length;

        // 캘리브레이션 적용 비율에 따른 신뢰도 가중치
        const reliabilityWeight = 0.7 + calibrationCoverage * 0.3;

        return Math.round((avgScore / 100) * 10 * reliabilityWeight);
    }

    /**
     * 종합 영상 지표 계산(캘리브레이션 고려) + 서브지표 제공
     */
    private async getVisualSummary(
        sessionId: string,
    ): Promise<NonNullable<InterviewAnalysisResult['visual_summary']>> {
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

        let overallScore10: number;
        let coverage = 0;
        if (count > 0) {
            const avgScore = sum / count; // 0-100
            coverage = calibratedCount / count;
            const reliabilityWeight = 0.7 + coverage * 0.3;
            overallScore10 = Math.round((avgScore / 100) * 10 * reliabilityWeight);
        } else {
            overallScore10 = this.getFallbackVisualScore(overall) || 0;
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

    /**
     * 질문 ID 목록 조회
     */
    private async getQuestionIds(sessionId: string): Promise<string[]> {
        const rows = await this.db.query<{ question_id: string }>(
            `SELECT DISTINCT question_id FROM visual_agg_question WHERE session_id = ?`,
            [sessionId],
        );
        return rows.map((r) => r.question_id);
    }

    /**
     * 폴백: 캘리브레이션 없을 때 기존 음성 점수
     */
    private getFallbackAudioScore(audioAll?: Partial<AudioFeatures> | null): number {
        if (!audioAll) return 6;

        const f = audioAll as AudioFeatures;

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

        // 페이스 점수 (침묵 비율)
        const talkRatio = 1 - (f.silence_ratio ?? 0);
        const paceScore = Math.round((1 - Math.abs(talkRatio - 0.6) / 0.6) * 100);

        const avgScore = (toneScore + vibratoScore + paceScore) / 3;
        return Math.round(avgScore / 10);
    }

    /**
     * 평균 특성치로부터 서브 점수(tone/vibrato/pace) 계산 (0-100)
     */
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

    /**
     * 폴백: 캘리브레이션 없을 때 기존 영상 점수
     */
    private getFallbackVisualScore(visual?: SessionVisualAggregate['overall'] | null): number {
        if (!visual) return 6;

        const count = visual.count || 0;
        const conf = typeof visual.confidence_mean === 'number' ? visual.confidence_mean : 0.65;
        const good = count ? (visual.presence_dist?.good ?? 0) / count : 0;

        // 스마일 밸런스 (0.5가 최적)
        const smile = (visual as any).smile_mean;
        const smileBalance =
            typeof smile === 'number' ? 1 - Math.min(1, Math.abs(smile - 0.5) / 0.5) : 0.5;

        const eye =
            typeof (visual as any).eye_contact_mean === 'number'
                ? (visual as any).eye_contact_mean
                : 0.6;
        const gaze =
            typeof (visual as any).gaze_stability === 'number'
                ? (visual as any).gaze_stability
                : 0.6;

        const base = 0.4 * conf + 0.25 * good + 0.15 * smileBalance + 0.1 * eye + 0.1 * gaze;

        // 경고/위험 신호 페널티
        const warnRatio = count ? (visual.level_dist?.warning ?? 0) / count : 0;
        const critRatio = count ? (visual.level_dist?.critical ?? 0) / count : 0;
        const penalty = Math.min(0.4, 0.6 * warnRatio + 1.0 * critRatio);

        const score01 = Math.max(0, Math.min(1, base - penalty));
        return Math.round(score01 * 10);
    }

    /**
     * 캘리브레이션 정보 조회
     */
    private async getCalibrationInfo(sessionId: string) {
        const calibration = await this.calibration.getSessionCalibration(sessionId);
        return {
            audio_calibrated: !!calibration?.audioBaseline,
            visual_calibrated: !!calibration?.visualBaseline,
            calibration_applied: !!calibration?.audioBaseline || !!calibration?.visualBaseline,
        };
    }

    // ===== Main Report Computation =====

    private async computeEnhancedReport(
        sessionId: string,
        qa: any[],
    ): Promise<InterviewAnalysisResult> {
        // 사용 중단된 레거시 진입점: 신규 점수 체계로 위임
        return this.computeNewReport(sessionId);

        // // 1) 텍스트 기반 점수 (기존 로직 유지)
        // const stats = qa.map((q) => this.wordStats(q.answer || ''));
        // const avgWords = stats.length ? stats.reduce((a, s) => a + s.total, 0) / stats.length : 0;
        // const avgUniqueRatio = stats.length
        //     ? stats.reduce((a, s) => a + (s.total ? s.unique / s.total : 0), 0) / stats.length
        //     : 0;
        // const avgConnectors = stats.length
        //     ? stats.reduce((a, s) => a + s.connectors, 0) / stats.length
        //     : 0;
        // const avgDigits = stats.length
        //     ? stats.reduce((a, s) => a + s.digitCount, 0) / stats.length
        //     : 0;

        // const completeness10 = Math.round(4 + this.scale01(avgWords, 30, 120) * 6);
        // const specificity10 = Math.round(
        //     Math.min(
        //         10,
        //         2 + avgDigits * 1.5 + avgUniqueRatio * 5 + this.scale01(avgWords, 40, 100) * 2,
        //     ),
        // );
        // const logic10 = Math.round(
        //     Math.min(10, 3 + avgConnectors * 2 + this.scale01(avgWords, 40, 100) * 3),
        // );

        // // 2) 캘리브레이션 기반 인상 점수 + 음성/영상 요약(서브점수 포함)
        // const audio_summary = await this.getAudioSummary(sessionId);
        // const visual_summary = await this.getVisualSummary(sessionId);
        // const audioScore10 = audio_summary.overallScore10;
        // const visualScore10 = visual_summary.overallScore10;
        // const impression10 = Math.round(audioScore10 * 0.6 + visualScore10 * 0.4);

        // // 2.5) ===== NEW: LLM 텍스트(내용/맥락) 집계 =====
        // const perQs = await this.getPerQuestionTextAnalyses(sessionId);
        // const tAgg = this.aggregateTextAnalyses(perQs);

        // // 3) 전체 점수
        // const overall = Math.round(
        //     completeness10 * 2.5 + specificity10 * 2.5 + logic10 * 2.0 + impression10 * 3.0,
        // );

        // // 4) 캘리브레이션 정보
        // const calibrationInfo = await this.getCalibrationInfo(sessionId);

        // // 5) 강점/개선사항 (캘리브레이션 고려)
        // const strengths: string[] = [];
        // const improvements: string[] = [];

        // if (completeness10 >= 8) strengths.push('답변 길이와 구성의 균형이 좋습니다.');
        // else improvements.push('핵심-근거-사례 순서로 내용을 조금 더 확장하세요.');

        // if (specificity10 >= 8) strengths.push('수치·사례 등 구체적 근거가 잘 나타납니다.');
        // else improvements.push('숫자(성과, 지표)나 구체 사례를 1개 이상 포함하세요.');

        // if (logic10 >= 8) strengths.push('접속어 활용이 적절해 논리 전개가 매끄럽습니다.');
        // else improvements.push('따라서/왜냐하면 등 연결어로 흐름을 명확히 하세요.');

        // // 캘리브레이션 기반 피드백
        // if (calibrationInfo.calibration_applied) {
        //     if (audioScore10 >= 8) {
        //         strengths.push('평상시보다 음성이 안정적이고 명확했습니다.');
        //     } else if (audioScore10 <= 6) {
        //         improvements.push('캘리브레이션 대비 음성 품질 개선이 필요합니다.');
        //     }

        //     if (visualScore10 >= 8) {
        //         strengths.push('평상시보다 자신감 있고 집중된 모습을 보였습니다.');
        //     } else if (visualScore10 <= 6) {
        //         improvements.push('캘리브레이션 대비 표정/자세 개선이 필요합니다.');
        //     }
        // } else {
        //     // 폴백 피드백
        //     if (audioScore10 >= 8) strengths.push('목소리 톤과 속도가 적절합니다.');
        //     if (visualScore10 >= 8) strengths.push('자신감 있는 표정과 시선을 유지했습니다.');
        // }

        // // 5.5) ===== NEW: LLM 텍스트 집계 기반 피드백 보강 =====
        // if (tAgg.content_avg100 >= 80)
        //     strengths.push('답변 내용이 질문 의도에 맞고 구조화가 잘 되어 있습니다.');
        // else improvements.push('STAR 구조(상황-과제-행동-결과)로 핵심을 간결히 정리해보세요.');
        // if (tAgg.context_avg100 >= 80) strengths.push('이력서/경력과 답변의 연결이 명확합니다.');
        // else improvements.push('경력/성과와 직접 연결되는 문장을 1~2개 포함하세요.');
        // if (tAgg.contradiction)
        //     improvements.push('이전 답변과의 모순을 점검하고 일관된 스토리라인을 유지하세요.');

        // // 6) 문항별 상세 피드백
        // const detailed_feedback: InterviewAnalysisResult['detailed_feedback'] = {};
        // for (let i = 0; i < qa.length; i++) {
        //     const s = this.wordStats(qa[i].answer || '');
        //     const parts: string[] = [];

        //     if (s.total < 30) parts.push('답변 길이가 짧습니다.');
        //     if (s.digitCount < 1) parts.push('구체적 수치를 포함해보세요.');
        //     if (s.connectors < 1) parts.push('연결어로 흐름을 명확히 해주세요.');

        //     // 개별 문항 점수 (간소화)
        //     const baseScore = Math.round(
        //         (this.scale01(s.total, 30, 120) * 0.4 +
        //             (s.digitCount >= 1 ? 0.3 : 0) +
        //             (s.connectors >= 1 ? 0.3 : 0)) *
        //             10,
        //     );

        //     detailed_feedback[`question_${i + 1}`] = {
        //         score: Math.max(1, Math.min(10, baseScore)),
        //         feedback: parts.length ? parts.join(' ') : '답변이 적절합니다.',
        //     };
        // }

        // // 7) 전체 평가 및 권장사항
        // const calibrationNote = calibrationInfo.calibration_applied
        //     ? '개인 캘리브레이션이 적용되어 평상시 대비 향상도를 반영했습니다.'
        //     : '캘리브레이션이 없어 일반 기준으로 평가되었습니다.';

        // const overall_evaluation = `완성도 ${completeness10}/10, 구체성 ${specificity10}/10, 논리성 ${logic10}/10, 인상 ${impression10}/10로 평가됩니다. ${calibrationNote}`;

        // const recommendations: string[] = [];
        // if (specificity10 < 8) recommendations.push('모든 답변에 최소 1개의 수치/지표/사례를 포함');
        // if (logic10 < 8) recommendations.push('결론-근거-사례-요약의 4단 구조 유지');
        // if (impression10 < 8 && calibrationInfo.calibration_applied) {
        //     recommendations.push('캘리브레이션 대비 음성/영상 품질 개선 필요');
        // }
        // recommendations.push('핵심 문장을 1~2개로 요약해 마무리');
        // // (선택) LLM 텍스트 요약 기반 권장사항 보강
        // if (tAgg.content_avg100 < 80)
        //     recommendations.push('STAR 요소 중 결과(수치)를 명시적으로 포함');
        // if (tAgg.context_avg100 < 80)
        //     recommendations.push('이력서의 특정 경험/성과를 직접 인용하여 연결');

        // return {
        //     overall_score: Math.max(40, Math.min(98, overall)),
        //     detailed_scores: {
        //         completeness: Math.max(1, Math.min(10, completeness10)),
        //         specificity: Math.max(1, Math.min(10, specificity10)),
        //         logic: Math.max(1, Math.min(10, logic10)),
        //         impression: Math.max(1, Math.min(10, impression10)),
        //     },
        //     strengths,
        //     improvements,
        //     detailed_feedback,
        //     overall_evaluation,
        //     recommendations,
        //     calibration_info: calibrationInfo,
        //     audio_summary,
        //     visual_summary,
        //     // ===== NEW: LLM 텍스트 집계 결과를 리포트에 포함 =====
        //     text_analysis_summary: {
        //         content_avg100: tAgg.content_avg100,
        //         context_avg100: tAgg.context_avg100,
        //         overall_llm10: tAgg.overall_llm10,
        //         top_reasons: tAgg.top_reasons,
        //         top_improvements: tAgg.top_improvements,
        //     },
        //     evidence_links: tAgg.evidence_links,
        // };
    }

    // ===== New Main Report Computation =====
    private async computeNewReport(sessionId: string): Promise<InterviewAnalysisResult> {
        // 텍스트 분석 집계
        const perQs = await this.getPerQuestionTextAnalyses(sessionId);
        const tAgg = this.aggregateTextAnalyses(perQs);
        const content30 = Math.round((Math.max(0, Math.min(100, tAgg.content_avg100)) / 100) * 30);
        const context30 = Math.round((Math.max(0, Math.min(100, tAgg.context_avg100)) / 100) * 30);

        // 음성/영상 요약
        const audio_summary = await this.getAudioSummary(sessionId);
        const visual_summary = await this.getVisualSummary(sessionId);

        // 표현 지표 계산
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

        const overall_score = content30 + context30 + expression40;
        const calibrationInfo = await this.getCalibrationInfo(sessionId);

        // 이력서 요약 기반 1분 자기소개 생성
        const resumeSummary = await this.getResumeSummaryForSession(sessionId);
        const selfIntro = resumeSummary
            ? await this.generateSelfIntroWithOpenAI(resumeSummary)
            : undefined;

        return {
            overall_score,
            detailed_scores: { content30, context30, expression40 },
            expression_indices: {
                confidence: Math.round(confidenceIndex),
                clarity: Math.round(clarityIndex),
                engagement: Math.round(engagementIndex),
                composure: Math.round(composureIndex),
                professionalism: Math.round(professionalismRaw),
                consistency: Math.round(consistency),
                reliabilityWeight: Number(reliabilityWeight.toFixed(3)),
            },
            calibration_info: calibrationInfo,
            audio_summary,
            visual_summary,
            text_analysis_summary: {
                content_avg100: tAgg.content_avg100,
                context_avg100: tAgg.context_avg100,
                overall_llm10: tAgg.overall_llm10,
                top_reasons: tAgg.top_reasons,
                top_improvements: tAgg.top_improvements,
            },
            evidence_links: tAgg.evidence_links,
            self_intro_script: selfIntro,
        };
    }

    // ===== Persistence =====
    async getSavedReport(sessionId: string): Promise<InterviewAnalysisResult | null> {
        try {
            const rows = await this.db.query<any>(
                `SELECT payload FROM interview_reports WHERE session_id=?`,
                [sessionId],
            );
            if (!rows.length) return null;
            const raw = rows[0].payload;
            return typeof raw === 'string' ? JSON.parse(raw) : (raw as InterviewAnalysisResult);
        } catch {
            return null;
        }
    }

    async saveReport(sessionId: string, payload: InterviewAnalysisResult): Promise<void> {
        const questionEntries = Object.entries(payload.detailed_feedback || {});
        const questionCount = questionEntries.length;
        const overallScore = payload.overall_score ?? 0;

        await this.db.execute(
            `INSERT INTO interview_reports (session_id, overall_score, question_count, payload)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE 
               overall_score=VALUES(overall_score), 
               question_count=VALUES(question_count), 
               payload=VALUES(payload)`,
            [sessionId, overallScore, questionCount, JSON.stringify(payload)],
        );

        // 문항별 점수 저장
        for (const [key, val] of questionEntries) {
            const m = key.match(/question_(\d+)/);
            const idx = m ? parseInt(m[1], 10) : NaN;
            if (!Number.isFinite(idx)) continue;

            const qText = (val as any)?.question as string | undefined;
            const score = typeof val?.score === 'number' ? Math.round(val.score) : 0;

            await this.db.execute(
                `INSERT INTO interview_report_question_scores (session_id, question_index, question_text, score)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE 
                   question_text=VALUES(question_text), 
                   score=VALUES(score)`,
                [sessionId, idx, qText ?? null, score],
            );
        }
    }

    // ===== Public API =====
    async computeOnTheFly(
        sessionId: string,
        _dto?: AnalyzeReportDto,
    ): Promise<InterviewAnalysisResult> {
        return this.computeNewReport(sessionId);
    }

    async computeAndMaybeSave(
        sessionId: string,
        _dto?: AnalyzeReportDto,
    ): Promise<InterviewAnalysisResult> {
        const result = await this.computeNewReport(sessionId);

        // 질문 텍스트 포함하여 저장
        await this.saveReport(sessionId, result as InterviewAnalysisResult);

        return result;
    }

    // ===== Listing APIs (unchanged) =====
    async listReports(limit = 20, offset = 0, externalKey?: string) {
        const args: any[] = [];
        let where = '';
        if (externalKey) {
            where = 'WHERE s.external_key = ?';
            args.push(externalKey);
        }
        args.push(limit, offset);

        const rows = await this.db.query<any>(
            `SELECT r.session_id, r.overall_score, r.question_count, r.created_at
             FROM interview_reports r
             JOIN interview_sessions s ON s.session_id = r.session_id
             ${where}
             ORDER BY r.created_at DESC
             LIMIT ? OFFSET ?`,
            args,
        );
        return rows;
    }

    async listReportsByUser(userId: number, limit = 20, offset = 0) {
        const rows = await this.db.query<any>(
            `SELECT r.session_id, r.overall_score, r.question_count, r.created_at
             FROM interview_reports r
             JOIN interview_sessions s ON s.session_id = r.session_id
             WHERE s.user_id = ?
             ORDER BY r.created_at DESC
             LIMIT ? OFFSET ?`,
            [userId, limit, offset],
        );
        return rows;
    }
}
