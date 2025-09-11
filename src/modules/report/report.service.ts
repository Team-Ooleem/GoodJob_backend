import { Injectable } from '@nestjs/common';
import { MetricsService, SessionVisualAggregate } from '../metrics/metrics.service';
import { AudioMetricsService, AudioFeatures } from '../audio-metrics/audio-metrics.service';
import { DatabaseService } from '../../database/database.service';

type QAPair = { question: string; answer: string };

export type InterviewAnalysisResult = {
    overall_score: number;
    detailed_scores: {
        completeness: number;
        specificity: number;
        logic: number;
        impression: number;
    };
    strengths: string[];
    improvements: string[];
    detailed_feedback: Record<string, { score: number; feedback: string }>;
    overall_evaluation: string;
    recommendations: string[];
};

@Injectable()
export class ReportService {
    constructor(
        private readonly metrics: MetricsService,
        private readonly audio: AudioMetricsService,
        private readonly db: DatabaseService,
    ) {}

    // ===== Core compute (ported from frontend) =====

    private clamp01(x: number) {
        return Math.max(0, Math.min(1, x));
    }

    private scale01(x: number, a: number, b: number) {
        if (b <= a) return 0;
        const t = (x - a) / (b - a);
        return Math.max(0, Math.min(1, t));
    }

    private smileBalance01(v?: number | null) {
        if (typeof v !== 'number') return 0.5;
        return 1 - Math.min(1, Math.abs(v - 0.5) / 0.5);
    }

    private countConnectors(text: string) {
        const connectors = [
            '그래서',
            '따라서',
            '왜냐하면',
            '때문에',
            '하지만',
            '그러나',
            '또한',
            '그리고',
            '결과적으로',
            '먼저',
            '다음으로',
            '마지막으로',
        ];
        let n = 0;
        for (const c of connectors) {
            const re = new RegExp(c, 'g');
            n += (text.match(re) || []).length;
        }
        return n;
    }

    private wordStats(text: string) {
        const tokens = (text || '').trim().split(/\s+/).filter(Boolean);
        const total = tokens.length;
        const unique = new Set(tokens).size;
        const longWords = tokens.filter((w) => w.length >= 4).length;
        const digitCount = ((text || '').match(/[0-9]/g) || []).length;
        return {
            total,
            unique,
            longWords,
            digitCount,
            connectors: this.countConnectors(text || ''),
        };
    }

    private videoScore10FromAgg(v?: SessionVisualAggregate['overall'] | null) {
        if (!v) return 6; // fallback mid
        const count = v.count || 0;
        const conf = typeof v.confidence_mean === 'number' ? v.confidence_mean : 0.65; // 0~1
        const good = count ? (v.presence_dist?.good ?? 0) / count : 0;
        const smileB = this.smileBalance01((v as any).smile_mean); // 0~1
        const eye =
            typeof (v as any).eye_contact_mean === 'number' ? (v as any).eye_contact_mean : 0.6;
        const gaze =
            typeof (v as any).gaze_stability === 'number' ? (v as any).gaze_stability : 0.6;
        const warnR = count ? (v.level_dist?.warning ?? 0) / count : 0;
        const critR = count ? (v.level_dist?.critical ?? 0) / count : 0;
        const base = 0.4 * conf + 0.25 * good + 0.15 * smileB + 0.1 * eye + 0.1 * gaze; // 0~1
        const penalty = Math.min(0.4, 0.6 * warnR + 1.0 * critR); // 0~0.4
        const score01 = Math.max(0, Math.min(1, base - penalty));
        return Math.round(score01 * 10);
    }

    private toneScore(f: AudioFeatures | undefined) {
        if (!f) return undefined;
        const cv =
            typeof f.f0_cv === 'number' && isFinite(f.f0_cv) && f.f0_cv >= 0
                ? f.f0_cv
                : typeof f.f0_mean === 'number' && f.f0_mean > 0
                  ? (f.f0_std ?? 0) / f.f0_mean
                  : undefined;
        if (typeof cv === 'number' && isFinite(cv)) {
            // Common baseline (no personal calibration): lo=0.05 hi=0.35
            const lo = 0.05,
                hi = 0.35;
            const t = Math.min(1, Math.max(0, (cv - lo) / (hi - lo)));
            return Math.round((1 - t) * 100);
        }
        if (typeof f.f0_std_semitone === 'number' && f.f0_std_semitone >= 0) {
            const st = f.f0_std_semitone;
            const lo = 1.0,
                hi = 5.0;
            const t = Math.min(1, Math.max(0, (st - lo) / (hi - lo)));
            return Math.round((1 - t) * 100);
        }
        const std = typeof f.f0_std === 'number' && isFinite(f.f0_std) ? f.f0_std : 0;
        const t = Math.min(1, std / 80);
        return Math.round((1 - t) * 100);
    }

    private vibratoScore(f: AudioFeatures | undefined) {
        if (!f) return undefined;
        const nj = Math.min(1, (f.jitter_like ?? 0) / 1.0);
        const ns = Math.min(1, (f.shimmer_like ?? 0) / 1.0);
        const rmsVar =
            typeof f.rms_cv === 'number' && isFinite(f.rms_cv) ? f.rms_cv : (f.rms_std ?? 0);
        const nr = Math.min(1, (rmsVar as number) / 2.0);
        const bad = nj * 0.4 + ns * 0.4 + (nr as number) * 0.2;
        return Math.round((1 - bad) * 100);
    }

    private paceScore(f: AudioFeatures | undefined) {
        if (!f) return undefined;
        const talk = 1 - (f.silence_ratio ?? 0);
        const target = 0.6; // fallback target when no personal calibration
        const denom = target > 0 ? target : 0.6;
        const err = Math.abs(talk - target) / denom;
        return Math.round((1 - this.clamp01(err)) * 100);
    }

    private computeFrontendReport(
        qa: QAPair[],
        audioAll?: Partial<AudioFeatures> | null,
        visualAll?: SessionVisualAggregate['overall'] | null,
        audioPerQ?: Partial<AudioFeatures>[] | null,
    ): InterviewAnalysisResult {
        // 1) Text-based
        const stats = qa.map((q) => this.wordStats(q.answer || ''));
        const avgWords = stats.length ? stats.reduce((a, s) => a + s.total, 0) / stats.length : 0;
        const avgUniqueRatio = stats.length
            ? stats.reduce((a, s) => a + (s.total ? s.unique / s.total : 0), 0) / stats.length
            : 0;
        const avgConnectors = stats.length
            ? stats.reduce((a, s) => a + s.connectors, 0) / stats.length
            : 0;
        const avgDigits = stats.length
            ? stats.reduce((a, s) => a + s.digitCount, 0) / stats.length
            : 0;

        const completeness10 = Math.round(4 + this.scale01(avgWords, 30, 120) * 6); // 4~10
        const specificity10 = Math.round(
            Math.min(
                10,
                2 +
                    avgDigits * 1.5 +
                    (avgUniqueRatio || 0) * 5 +
                    this.scale01(avgWords, 40, 100) * 2,
            ),
        );
        const logic10 = Math.round(
            Math.min(10, 3 + avgConnectors * 2 + this.scale01(avgWords, 40, 100) * 3),
        );

        // 2) Audio/Video impression (0~10)
        const tScore =
            typeof audioAll !== 'undefined' ? this.toneScore(audioAll as AudioFeatures) : undefined;
        const vScore =
            typeof audioAll !== 'undefined'
                ? this.vibratoScore(audioAll as AudioFeatures)
                : undefined;
        const pScore =
            typeof audioAll !== 'undefined' ? this.paceScore(audioAll as AudioFeatures) : undefined;
        const a10 = [tScore, vScore, pScore]
            .filter((x): x is number => typeof x === 'number' && isFinite(x))
            .map((x) => x / 10);
        const audio10 = a10.length ? a10.reduce((a, b) => a + b, 0) / a10.length : 6.5;
        const visual10 = this.videoScore10FromAgg(visualAll);
        const impression10 = Math.round(audio10 * 0.6 + visual10 * 0.4);

        // 3) Overall score (0~100)
        const overall = Math.round(
            completeness10 * 2.5 + specificity10 * 2.5 + logic10 * 2.0 + impression10 * 3.0,
        );

        // 4) Strengths / improvements
        const strengths: string[] = [];
        const improvements: string[] = [];
        if (completeness10 >= 8) strengths.push('답변 길이와 구성의 균형이 좋습니다.');
        else improvements.push('핵심-근거-사례 순서로 내용을 조금 더 확장하세요.');
        if (specificity10 >= 8) strengths.push('수치·사례 등 구체적 근거가 잘 나타납니다.');
        else improvements.push('숫자(성과, 지표)나 구체 사례를 1개 이상 포함하세요.');
        if (logic10 >= 8) strengths.push('접속어 활용이 적절해 논리 전개가 매끄럽습니다.');
        else improvements.push('따라서/왜냐하면 등 연결어로 흐름을 명확히 하세요.');
        if ((tScore ?? 0) >= 80) strengths.push('목소리 톤이 안정적입니다.');
        if ((pScore ?? 0) >= 80) strengths.push('말 속도가 적정 범위입니다.');
        if (
            typeof (visualAll as any)?.confidence_mean === 'number' &&
            (visualAll as any).confidence_mean >= 0.7
        )
            strengths.push('자신감 있는 표정과 시선을 유지했습니다.');
        if (
            (visualAll as any)?.smile_mean != null &&
            (((visualAll as any).smile_mean as number) < 0.25 ||
                ((visualAll as any).smile_mean as number) > 0.75)
        )
            improvements.push('미소 강도를 너무 크거나 작지 않게 조절해보세요.');

        // 5) Per-question feedback (simple port)
        const detailed_feedback: InterviewAnalysisResult['detailed_feedback'] = {};
        qa.forEach((q, i) => {
            const s = this.wordStats(q.answer || '');
            const connectorsGood = s.connectors >= 1;
            const parts: string[] = [];
            if (s.total < 30) parts.push('답변 길이가 짧습니다. 핵심-근거-사례로 보강해보세요.');
            if (s.digitCount < 1)
                parts.push('구체적 수치나 지표를 1개 이상 포함하면 설득력이 올라갑니다.');
            if (!connectorsGood) parts.push('따라서·왜냐하면 등 연결어로 흐름을 분명히 해 주세요.');

            const apq = (audioPerQ && audioPerQ[i]) as AudioFeatures | undefined;
            const tone = this.toneScore(apq);
            const vib = this.vibratoScore(apq);
            const pace = this.paceScore(apq);
            const audio10q = [tone, vib, pace]
                .filter((x): x is number => typeof x === 'number' && isFinite(x))
                .map((x) => x / 10);

            const score10 = Math.round(
                (this.scale01(s.total, 30, 120) * 0.4 +
                    (s.digitCount >= 1 ? 0.2 : 0) +
                    (connectorsGood ? 0.1 : 0) +
                    (audio10q.length
                        ? audio10q.reduce((a, b) => a + b, 0) / audio10q.length
                        : 0.65) *
                        0.3) *
                    10,
            );

            detailed_feedback[`question_${i + 1}`] = {
                score: Math.max(1, Math.min(10, score10)),
                feedback: parts.join(' '),
            };
        });

        const overall_evaluation =
            `완성도 ${completeness10}/10, 구체성 ${specificity10}/10, 논리성 ${logic10}/10, 인상 ${impression10}/10로 평가됩니다. ` +
            `음성/표정 지표를 종합하면 기본기는 충분하며, 사례·지표 보강과 구조화로 설득력을 한층 높일 수 있습니다.`;

        const recommendations: string[] = [];
        if (specificity10 < 8) recommendations.push('모든 답변에 최소 1개의 수치/지표/사례를 포함');
        if (logic10 < 8) recommendations.push('결론-근거-사례-요약의 4단 구조 유지');
        if ((tScore ?? 0) < 75) recommendations.push('호흡-강세-멈춤으로 톤 안정화 연습');
        if ((pScore ?? 0) < 75) recommendations.push('개인 발화 비율 기준(≈60%)에 맞춰 속도 조절');
        recommendations.push('핵심 문장을 1~2개로 요약해 마무리');

        return {
            overall_score: Math.max(40, Math.min(98, overall)),
            detailed_scores: {
                completeness: Math.max(1, Math.min(10, completeness10)),
                specificity: Math.max(1, Math.min(10, specificity10)),
                logic: Math.max(1, Math.min(10, logic10)),
                impression: Math.max(1, Math.min(10, impression10)),
            },
            strengths,
            improvements,
            detailed_feedback,
            overall_evaluation,
            recommendations,
        };
    }

    // ===== Persistence (optional) =====
    async getSavedReport(sessionId: string): Promise<InterviewAnalysisResult | null> {
        try {
            const rows = await this.db.query<any>(
                `SELECT payload FROM interview_reports WHERE session_id=?`,
                [sessionId],
            );
            if (!rows.length) return null;
            const raw = rows[0].payload;
            // MySQL JSON returns object already; TEXT would be string
            return typeof raw === 'string' ? JSON.parse(raw) : (raw as InterviewAnalysisResult);
        } catch {
            return null;
        }
    }

    async saveReport(sessionId: string, payload: InterviewAnalysisResult): Promise<void> {
        const questionEntries = Object.entries(payload.detailed_feedback || {});
        const questionCount = questionEntries.length;
        const overallScore = payload.overall_score ?? 0;

        // Upsert summary with scalar columns for efficient listing
        await this.db.execute(
            `INSERT INTO interview_reports (session_id, overall_score, question_count, payload)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE overall_score=VALUES(overall_score), question_count=VALUES(question_count), payload=VALUES(payload)`,
            [sessionId, overallScore, questionCount, JSON.stringify(payload)],
        );

        // Upsert per-question scores
        for (const [key, val] of questionEntries) {
            // key format: question_1, question_2, ...
            const m = key.match(/question_(\d+)/);
            const idx = m ? parseInt(m[1], 10) : NaN;
            if (!Number.isFinite(idx)) continue;
            const qIndex = idx;
            const qText = (val as any)?.question as string | undefined;
            const score = typeof val?.score === 'number' ? Math.round(val.score) : 0;
            await this.db.execute(
                `INSERT INTO interview_report_question_scores (session_id, question_index, question_text, score)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE question_text=VALUES(question_text), score=VALUES(score)`,
                [sessionId, qIndex, qText ?? null, score],
            );
        }
    }

    // ===== Public API used by controller =====
    async computeOnTheFly(sessionId: string, qa: QAPair[]): Promise<InterviewAnalysisResult> {
        const visual = (await this.metrics.getSessionAggregate(sessionId))?.overall ?? null;
        const audioAll = await this.audio.getSessionAudioOverall(sessionId);
        const audioPerQRows = await this.audio.getPerQuestion(sessionId);
        const audioPerQ = (audioPerQRows || []).map((r: any) => ({
            f0_mean: r.f0_mean,
            f0_std: r.f0_std,
            f0_cv: r.f0_cv,
            f0_std_semitone: r.f0_std_semitone,
            rms_std: r.rms_std,
            rms_cv: r.rms_cv,
            jitter_like: r.jitter_like,
            shimmer_like: r.shimmer_like,
            silence_ratio: r.silence_ratio,
            sr: r.sr,
        }));

        return this.computeFrontendReport(qa, audioAll, visual, audioPerQ);
    }

    async computeAndMaybeSave(sessionId: string, qa: QAPair[]): Promise<InterviewAnalysisResult> {
        const result = await this.computeOnTheFly(sessionId, qa);
        // Save result (optional): enable by default so GET works
        // also store question texts alongside scores when available
        await this.saveReport(sessionId, {
            ...result,
            detailed_feedback: Object.fromEntries(
                Object.entries(result.detailed_feedback).map(([k, v], i) => {
                    const q = qa[i]?.question ?? undefined;
                    // Save question_text if we can
                    (v as any).question = q;
                    return [k, v];
                }),
            ),
        } as InterviewAnalysisResult);
        return result;
    }

    // ===== Listing APIs =====
    async listReports(limit = 20, offset = 0, externalKey?: string) {
        const args: any[] = [];
        let where = '';
        if (externalKey) {
            where = 'WHERE s.external_key = ?';
            args.push(externalKey);
        }
        args.push(limit);
        args.push(offset);
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
}
