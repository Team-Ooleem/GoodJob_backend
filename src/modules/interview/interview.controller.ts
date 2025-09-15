// src/modules/interview/interview.controller.ts
import { BadRequestException, Body, Controller, Post, Req, Param, Logger } from '@nestjs/common';
import { ResumeFileService } from '@/modules/resume-file/resume-file.service';
import { z } from 'zod';
import {
    AiService,
    type QuestionResult,
    type FollowupsResult,
    type CreateFollowupsParams,
    type AnalysisResult,
} from './interview.service';
import { DatabaseService } from '@/database/database.service';

// ===== 요청 바디 스키마 & 타입 =====
const CreateQuestionBodySchema = z.union([
    z.object({ resumeSummary: z.string().min(10) }),
    z.object({ resumeFileId: z.string().min(1) }),
]);

const CreateFollowupsBodySchema = z.object({
    originalQuestion: z.object({
        id: z.string(),
        text: z.string().min(5),
    }),
    answer: z.string().min(5),
});

const AnalyzeAnswerBodySchema = z.object({
    answer: z.string().min(5),
    resumeFileId: z.string().optional(),
    prevClaims: z.array(z.string()).optional(),
});

@Controller('ai')
export class AiController {
    private readonly logger = new Logger(AiController.name);
    constructor(
        private readonly ai: AiService,
        private readonly resumeFiles: ResumeFileService,
        private readonly db: DatabaseService,
    ) {}

    // POST /api/ai/question
    @Post('question')
    async createQuestion(@Body() body: unknown, @Req() req: any): Promise<QuestionResult> {
        this.logger.log(`POST /ai/question bodyKeys=${Object.keys((body as any) || {}).join(',')}`);
        const parsed = CreateQuestionBodySchema.safeParse(body);
        if (!parsed.success) {
            this.logger.warn(
                `createQuestion 스키마 오류: ${JSON.stringify(parsed.error.flatten())}`,
            );
            throw new BadRequestException(parsed.error.flatten());
        }
        const userId = Number((req as any).user_idx ?? (req as any).user?.idx);
        if (!userId) throw new BadRequestException('unauthorized');
        if ('resumeFileId' in parsed.data) {
            this.logger.log(`createQuestion: resumeFileId=${parsed.data.resumeFileId}`);
            const summary = await this.resumeFiles.getSummaryById(parsed.data.resumeFileId, userId);
            if (!summary || summary.length < 10) {
                throw new BadRequestException('요약이 비어있습니다. 먼저 요약을 등록하세요.');
            }
            return this.ai.createQuestion(summary);
        }
        this.logger.log(`createQuestion: resumeSummaryLen=${parsed.data.resumeSummary.length}`);
        return this.ai.createQuestion(parsed.data.resumeSummary);
    }

    // POST /api/ai/followups
    @Post('followups')
    async createFollowups(@Body() body: unknown): Promise<FollowupsResult> {
        this.logger.log(
            `POST /ai/followups bodyKeys=${Object.keys((body as any) || {}).join(',')}`,
        );
        const parsed = CreateFollowupsBodySchema.safeParse(body);
        if (!parsed.success) {
            this.logger.warn(
                `createFollowups 스키마 오류: ${JSON.stringify(parsed.error.flatten())}`,
            );
            throw new BadRequestException(parsed.error.flatten());
        }
        // 스키마로 보장된 타입을 서비스 입력 DTO로 그대로 사용
        const params: CreateFollowupsParams = parsed.data;
        return this.ai.createFollowups(params);
    }

    /**
     * 문항 종료 시 답변의 내용/맥락 분석을 수행하고 DB에만 저장한다.
     * 프론트엔드로는 즉시 반환하지 않고, 면접 종료 시점에 모아 제공한다.
     */
    @Post(':sessionId/:questionId/analyze')
    async analyzeAndStore(
        @Param('sessionId') sessionId: string,
        @Param('questionId') questionId: string,
        @Body() body: unknown,
        @Req() req: any,
    ): Promise<{ ok: true } | never> {
        this.logger.log(
            `POST /ai/${sessionId}/${questionId}/analyze bodyKeys=${Object.keys((body as any) || {}).join(',')}`,
        );
        try {
            const parsed = AnalyzeAnswerBodySchema.safeParse(body);
            if (!parsed.success) {
                this.logger.warn(
                    `analyzeAndStore 스키마 오류: ${JSON.stringify(parsed.error.flatten())}`,
                );
                throw new BadRequestException(parsed.error.flatten());
            }
            const userId = Number(req.user_idx ?? req.user?.idx);
            if (!userId) throw new BadRequestException('unauthorized');

            const { answer, resumeFileId, prevClaims = [] } = parsed.data;
            this.logger.log(
                `analyzeAndStore 입력: userId=${userId}, resumeFileId=${resumeFileId}, aLen=${answer?.length ?? 0}, prevClaims=${prevClaims?.length ?? 0}`,
            );

            // 이력서 텍스트(요약 우선) 로딩
            let resumeText = '';
            if (resumeFileId) {
                const resume = await this.resumeFiles.getMine(resumeFileId, userId);
                resumeText = (
                    resume.summary?.trim()?.length
                        ? resume.summary
                        : (resume as any).text_content || ''
                )
                    .toString()
                    .trim();
            }
            if (!resumeText) {
                this.logger.warn('analyzeAndStore: resumeText 없음');
                throw new BadRequestException(
                    '이력서 요약 또는 원문이 필요합니다. resumeFileId를 확인하세요.',
                );
            }

            // 분석 수행
            const analysis: AnalysisResult = await this.ai.analyzeAnswer(
                answer,
                resumeText,
                prevClaims,
            );

            // DB 저장(업서트)
            await this.db.execute(
                `INSERT INTO interview_answer_analyses (session_id, question_id, content_analysis_json, context_analysis_json)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE 
                   content_analysis_json = VALUES(content_analysis_json),
                   context_analysis_json = VALUES(context_analysis_json)`,
                [
                    sessionId,
                    questionId,
                    JSON.stringify(analysis.content),
                    JSON.stringify(analysis.context),
                ],
            );
            this.logger.log(
                `analyzeAndStore 저장 완료: sessionId=${sessionId}, questionId=${questionId}`,
            );
            return { ok: true };
        } catch (e: any) {
            this.logger.error(
                `analyzeAndStore 실패: sessionId=${sessionId}, questionId=${questionId}, err=${e?.message}`,
                e?.stack,
            );
            throw e;
        }
    }

    /**
     * 세션의 모든 문항 분석 결과 조회(면접 종료 시점에 호출하여 일괄 전송)
     */
    @Post(':sessionId/finalize-analyses')
    async finalizeAnalyses(@Param('sessionId') sessionId: string) {
        this.logger.log(`POST /ai/${sessionId}/finalize-analyses`);
        const rows = await this.db.query<any>(
            `SELECT question_id, content_analysis_json, context_analysis_json
             FROM interview_answer_analyses WHERE session_id = ? ORDER BY question_id`,
            [sessionId],
        );
        const analyses = rows.map((r) => ({
            questionId: r.question_id,
            content: r.content_analysis_json,
            context: r.context_analysis_json,
        }));
        this.logger.log(`finalizeAnalyses 반환: sessionId=${sessionId}, count=${analyses.length}`);
        return { ok: true, analyses };
    }
}
