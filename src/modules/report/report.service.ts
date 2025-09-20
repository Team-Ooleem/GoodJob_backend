import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AnalyzeReportDto } from './dto/analyze-report.dto';
import { InterviewAnalysisResult } from './types/report.types';
import { TextAnalysisService } from './services/text-analysis.service';
import { AudioAnalysisService } from './services/audio-analysis.service';
import { VisualAnalysisService } from './services/visual-analysis.service';
import { ScoreCalculationService } from './services/score-calculation.service';

@Injectable()
export class ReportService {
    constructor(
        private readonly db: DatabaseService,
        private readonly textAnalysis: TextAnalysisService,
        private readonly audioAnalysis: AudioAnalysisService,
        private readonly visualAnalysis: VisualAnalysisService,
        private readonly scoreCalculation: ScoreCalculationService,
    ) {}

    // ===== Persistence =====
    async getSavedReport(sessionId: string): Promise<InterviewAnalysisResult | null> {
        try {
            const rows = await this.db.query<{ payload: string | InterviewAnalysisResult }>(
                `SELECT payload FROM interview_reports WHERE session_id=?`,
                [sessionId],
            );
            if (!rows.length) return null;
            const raw = rows[0]?.payload;
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
            return null;
        }
    }

    async saveReport(sessionId: string, payload: InterviewAnalysisResult): Promise<void> {
        const overallScore = payload.overall_score ?? 0;

        // 세션에서 user_id 조회 후 보고서에 함께 저장
        const sessRows = await this.db.query<{ user_id: number }>(
            `SELECT user_id FROM interview_sessions WHERE session_id = ?`,
            [sessionId],
        );
        const userId = sessRows[0]?.user_id;
        if (!userId) {
            // 세션이 없으면 저장하지 않음 (무결성 보장)
            return;
        }

        await this.db.execute(
            `INSERT INTO interview_reports (session_id, user_id, overall_score, question_count, payload)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE 
               user_id=VALUES(user_id),
               overall_score=VALUES(overall_score), 
               question_count=VALUES(question_count), 
               payload=VALUES(payload)`,
            [sessionId, userId, overallScore, 0, JSON.stringify(payload)],
        );

        // 리포트 발행 시점에 세션 종료 시간 기록(최초 1회만)
        await this.db.execute(
            `UPDATE interview_sessions SET ended_at = COALESCE(ended_at, NOW()) WHERE session_id = ?`,
            [sessionId],
        );
    }

    // ===== Public API =====
    async getOverallScore(sessionId: string): Promise<number> {
        // 먼저 저장된 리포트에서 overall_score 조회
        const saved = await this.getSavedReport(sessionId);
        if (saved) {
            return saved.overall_score;
        }

        // 저장된 리포트가 없으면 overall_score만 계산
        return this.computeOverallScoreOnly(sessionId);
    }

    // 1. InterviewReport (메인) - overall_score만
    async getOverall(sessionId: string): Promise<{ overallScore: number }> {
        const overallScore = await this.getOverallScore(sessionId);
        return { overallScore };
    }

    // 2. DetailedScoresCard - detailed_scores
    async getDetailedScores(
        sessionId: string,
    ): Promise<{ detailedScores: { content30: number; context30: number; expression40: number } }> {
        // 텍스트 분석 집계
        const perQs = await this.textAnalysis.getPerQuestionTextAnalyses(sessionId);
        const tAgg = this.textAnalysis.aggregateTextAnalyses(perQs);
        const content30 = Math.round((Math.max(0, Math.min(100, tAgg.content_avg100)) / 100) * 30);
        const context30 = Math.round((Math.max(0, Math.min(100, tAgg.context_avg100)) / 100) * 30);

        // 음성/영상 요약
        const [audio_summary, visual_summary] = await Promise.all([
            this.audioAnalysis.getAudioSummary(sessionId),
            this.visualAnalysis.getVisualSummary(sessionId),
        ]);

        // 표현 지표 계산
        const expression40 = this.scoreCalculation.computeExpression40(
            audio_summary,
            visual_summary,
        );

        return {
            detailedScores: {
                content30,
                context30,
                expression40,
            },
        };
    }

    // 3. ExpressionIndicesCard - expression_indices
    async getExpressionIndices(
        sessionId: string,
    ): Promise<{ expressionIndices: InterviewAnalysisResult['expression_indices'] }> {
        // 음성/영상 요약
        const [audio_summary, visual_summary] = await Promise.all([
            this.audioAnalysis.getAudioSummary(sessionId),
            this.visualAnalysis.getVisualSummary(sessionId),
        ]);

        // 표현 지수 계산
        const expressionIndices = this.scoreCalculation.computeExpressionIndices(
            audio_summary,
            visual_summary,
        );
        return { expressionIndices };
    }

    // 4. TextAnalysisCard - text_analysis_summary
    async getTextAnalysis(
        sessionId: string,
    ): Promise<{ textAnalysis: InterviewAnalysisResult['text_analysis_summary'] }> {
        // 텍스트 분석 집계
        const perQs = await this.textAnalysis.getPerQuestionTextAnalyses(sessionId);
        const tAgg = this.textAnalysis.aggregateTextAnalyses(perQs);

        const textAnalysis = {
            content_avg100: tAgg.content_avg100,
            context_avg100: tAgg.context_avg100,
            overall_llm10: tAgg.overall_llm10,
            top_reasons: tAgg.top_reasons,
            top_improvements: tAgg.top_improvements,
        };

        return { textAnalysis };
    }

    // 5. AudioVisualAnalysisCard - audio_summary, visual_summary
    async getAudioVisual(sessionId: string): Promise<{
        audioSummary: InterviewAnalysisResult['audio_summary'];
        visualSummary: InterviewAnalysisResult['visual_summary'];
    }> {
        // 음성/영상 요약
        const [audioSummary, visualSummary] = await Promise.all([
            this.audioAnalysis.getAudioSummary(sessionId),
            this.visualAnalysis.getVisualSummary(sessionId),
        ]);

        return {
            audioSummary,
            visualSummary,
        };
    }

    // 6. QuestionFeedbackCard - evidence_links
    async getQuestionFeedback(
        sessionId: string,
    ): Promise<{ questionFeedback: InterviewAnalysisResult['evidence_links'] }> {
        // 텍스트 분석 집계에서 evidence_links 추출
        const perQs = await this.textAnalysis.getPerQuestionTextAnalyses(sessionId);
        const tAgg = this.textAnalysis.aggregateTextAnalyses(perQs);

        return { questionFeedback: tAgg.evidence_links };
    }

    // 7. OverallEvaluationCard - text_analysis_summary (top_reasons, top_improvements)
    async getOverallEvaluation(
        sessionId: string,
    ): Promise<{ topReasons: string[]; topImprovements: string[] }> {
        // 텍스트 분석 집계에서 top_reasons, top_improvements 추출
        const perQs = await this.textAnalysis.getPerQuestionTextAnalyses(sessionId);
        const tAgg = this.textAnalysis.aggregateTextAnalyses(perQs);

        return {
            topReasons: tAgg.top_reasons || [],
            topImprovements: tAgg.top_improvements || [],
        };
    }

    // 8. SelfIntroScriptCard - self_intro_script
    async getSelfIntro(sessionId: string): Promise<{ selfIntroScript: string | undefined }> {
        // 이력서 요약 기반 1분 자기소개 생성
        const resumeSummary = await this.textAnalysis.getResumeSummaryForSession(sessionId);
        const selfIntroScript = resumeSummary
            ? await this.textAnalysis.generateSelfIntroWithOpenAI(resumeSummary)
            : undefined;

        return { selfIntroScript };
    }

    // overall_score만 빠르게 계산하는 메서드
    private async computeOverallScoreOnly(sessionId: string): Promise<number> {
        // 텍스트 분석 집계
        const perQs = await this.textAnalysis.getPerQuestionTextAnalyses(sessionId);
        const tAgg = this.textAnalysis.aggregateTextAnalyses(perQs);
        const content30 = Math.round((Math.max(0, Math.min(100, tAgg.content_avg100)) / 100) * 30);
        const context30 = Math.round((Math.max(0, Math.min(100, tAgg.context_avg100)) / 100) * 30);

        // 음성/영상 요약
        const [audio_summary, visual_summary] = await Promise.all([
            this.audioAnalysis.getAudioSummary(sessionId),
            this.visualAnalysis.getVisualSummary(sessionId),
        ]);

        // 표현 지표 계산
        const expression40 = this.scoreCalculation.computeExpression40(
            audio_summary,
            visual_summary,
        );

        return content30 + context30 + expression40;
    }

    async computeAndMaybeSave(
        sessionId: string,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _dto?: AnalyzeReportDto,
    ): Promise<InterviewAnalysisResult> {
        // 개별 API들을 조합해서 전체 리포트 생성
        const [
            detailedScores,
            expressionIndices,
            textAnalysis,
            audioVisual,
            questionFeedback,
            overallEvaluation,
            selfIntro,
            calibrationInfo,
        ] = await Promise.all([
            this.getDetailedScores(sessionId),
            this.getExpressionIndices(sessionId),
            this.getTextAnalysis(sessionId),
            this.getAudioVisual(sessionId),
            this.getQuestionFeedback(sessionId),
            this.getOverallEvaluation(sessionId),
            this.getSelfIntro(sessionId),
            this.scoreCalculation.getCalibrationInfo(sessionId),
        ]);

        const result: InterviewAnalysisResult = {
            overall_score:
                detailedScores.detailedScores.content30 +
                detailedScores.detailedScores.context30 +
                detailedScores.detailedScores.expression40,
            detailed_scores: detailedScores.detailedScores,
            expression_indices: expressionIndices.expressionIndices,
            calibration_info: calibrationInfo,
            audio_summary: audioVisual.audioSummary,
            visual_summary: audioVisual.visualSummary,
            text_analysis_summary: textAnalysis.textAnalysis,
            evidence_links: questionFeedback.questionFeedback,
            self_intro_script: selfIntro.selfIntroScript,
        };

        // 질문 텍스트 포함하여 저장
        await this.saveReport(sessionId, result);

        return result;
    }

    // ===== Listing APIs (unchanged) =====
    async listReports(limit = 20, offset = 0, externalKey?: string): Promise<any[]> {
        const args: any[] = [];
        let where = '';
        if (externalKey) {
            where = 'WHERE s.external_key = ?';
            args.push(externalKey);
        }
        args.push(limit, offset);

        const rows = await this.db.query<{
            session_id: string;
            overall_score: number;
            question_count: number;
            created_at: Date;
        }>(
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

    async listReportsByUser(userId: number, limit = 20, offset = 0): Promise<any[]> {
        const rows = await this.db.query<{
            session_id: string;
            overall_score: number;
            question_count: number;
            created_at: Date;
        }>(
            `SELECT r.session_id, r.overall_score, r.question_count, r.created_at
             FROM interview_reports r
             WHERE r.user_id = ?
             ORDER BY r.created_at DESC
             LIMIT ? OFFSET ?`,
            [userId, limit, offset],
        );
        return rows;
    }
}
