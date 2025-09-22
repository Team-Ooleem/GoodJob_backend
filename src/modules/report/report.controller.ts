import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { AnalyzeReportDto } from './dto/analyze-report.dto';
import { ReportService } from './report.service';

@Controller('report')
export class ReportController {
    constructor(private readonly svc: ReportService) {}

    @Post(':sessionId/analyze')
    async analyze(@Param('sessionId') sessionId: string, @Body() dto: AnalyzeReportDto) {
        const data = await this.svc.computeAndMaybeSave(sessionId, dto);
        return { success: true, data };
    }

    // 1. InterviewReport (메인) - overall_score만
    @Get(':sessionId/overall')
    async getOverall(@Param('sessionId') sessionId: string) {
        const overallScore = await this.svc.getOverallScore(sessionId);
        return { success: true, data: { overallScore } };
    }

    // 2. DetailedScoresCard - detailed_scores
    @Get(':sessionId/detailed-scores')
    async getDetailedScores(@Param('sessionId') sessionId: string) {
        const detailedScores = await this.svc.getDetailedScores(sessionId);
        return { success: true, data: detailedScores };
    }

    // 3. ExpressionIndicesCard - expression_indices
    @Get(':sessionId/expression-indices')
    async getExpressionIndices(@Param('sessionId') sessionId: string) {
        const expressionIndices = await this.svc.getExpressionIndices(sessionId);
        return { success: true, data: expressionIndices };
    }

    // 4. TextAnalysisCard - text_analysis_summary
    @Get(':sessionId/text-analysis')
    async getTextAnalysis(@Param('sessionId') sessionId: string) {
        const textAnalysis = await this.svc.getTextAnalysis(sessionId);
        return { success: true, data: textAnalysis };
    }

    // 5. AudioVisualAnalysisCard - audio_summary, visual_summary
    @Get(':sessionId/audio-visual')
    async getAudioVisual(@Param('sessionId') sessionId: string) {
        const audioVisual = await this.svc.getAudioVisual(sessionId);
        return { success: true, data: audioVisual };
    }

    // 6. QuestionFeedbackCard - evidence_links
    @Get(':sessionId/question-feedback')
    async getQuestionFeedback(@Param('sessionId') sessionId: string) {
        const questionFeedback = await this.svc.getQuestionFeedback(sessionId);
        return { success: true, data: questionFeedback };
    }

    // 7. OverallEvaluationCard - text_analysis_summary (top_reasons, top_improvements)
    @Get(':sessionId/overall-evaluation')
    async getOverallEvaluation(@Param('sessionId') sessionId: string) {
        const overallEvaluation = await this.svc.getOverallEvaluation(sessionId);
        return { success: true, data: overallEvaluation };
    }

    // 8. SelfIntroScriptCard - self_intro_script
    @Get(':sessionId/self-intro')
    async getSelfIntro(@Param('sessionId') sessionId: string) {
        const selfIntro = await this.svc.getSelfIntro(sessionId);
        return { success: true, data: selfIntro };
    }

    // List my reports based on authenticated user
    @Get('my')
    async listMy(@Req() req?: any) {
        const userId = Number(req?.user_idx ?? req?.user?.idx);
        const rows = await this.svc.listReportsByUser(userId);
        return { success: true, data: rows };
    }
}
