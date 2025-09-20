// src/modules/interview/interview.controller.ts
import {
    BadRequestException,
    Body,
    Controller,
    Post,
    Req,
    Param,
    Logger,
    Get,
} from '@nestjs/common';
import { ResumeFileService } from '@/modules/resume-file/resume-file.service';
import { z } from 'zod';
import {
    AiService,
    type QuestionResult,
    type FollowupsResult,
    type CreateFollowupsParams,
    type AnalysisResult,
} from './interview.service';
import { JobExtractService, type ExtractResult } from './job-extract.service';
import { DatabaseService } from '@/database/database.service';

// ===== 요청 바디 스키마 & 타입 =====
const CreateQuestionBodySchema = z
    .union([
        z.object({ resumeSummary: z.string().min(10) }),
        z.object({ resumeFileId: z.string().min(1) }),
    ])
    .and(
        z.object({
            sessionId: z.string().optional(),
            jobPostUrl: z.string().url().optional(),
        }),
    );

const CreateFollowupsBodySchema = z.object({
    originalQuestion: z.object({
        id: z.string(),
        text: z.string().min(5),
    }),
    answer: z.string().min(5),
    sessionId: z.string().optional(),
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
        private readonly jobExtract: JobExtractService,
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
        const anyData = parsed.data as any;
        const sessionId: string | undefined = anyData.sessionId;
        const jobPostUrl: string | undefined = anyData.jobPostUrl;

        if ('resumeFileId' in parsed.data) {
            this.logger.log(`createQuestion: resumeFileId=${parsed.data.resumeFileId}`);
            const summary = await this.resumeFiles.getSummaryById(parsed.data.resumeFileId, userId);
            if (!summary || summary.length < 10) {
                throw new BadRequestException('요약이 비어있습니다. 먼저 요약을 등록하세요.');
            }
            // 세션-이력서 연결: 세션이 있다면 external_key로 이력서 파일 id 저장
            if (sessionId && parsed.data.resumeFileId) {
                await this.db.execute(
                    `INSERT INTO interview_sessions (session_id, user_id, external_key)
                     VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE 
                       external_key = IFNULL(external_key, VALUES(external_key))`,
                    [sessionId, userId, parsed.data.resumeFileId],
                );
            }
            return this.ai.createQuestionWithJobPost(summary, { sessionId, jobPostUrl });
        }
        this.logger.log(
            `createQuestion: resumeSummaryLen=${parsed.data.resumeSummary.length}, jobPostUrl=${jobPostUrl ? 'Y' : 'N'}`,
        );
        return this.ai.createQuestionWithJobPost(parsed.data.resumeSummary, {
            sessionId,
            jobPostUrl,
        });
    }

    // POST /api/ai/job-extract (프런트 사전 검증/프리뷰용)
    @Post('job-extract')
    async extractJob(@Body() body: unknown): Promise<
        ExtractResult & {
            summary?: string;
            summaryJson?: import('./job-extract.service').JobPostSummary;
        }
    > {
        this.logger.log(
            `POST /ai/job-extract bodyKeys=${Object.keys((body as any) || {}).join(',')}`,
        );
        const schema = z.object({ url: z.string().url(), sessionId: z.string().optional() });
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
            this.logger.warn(`job-extract 스키마 오류: ${JSON.stringify(parsed.error.flatten())}`);
            throw new BadRequestException(parsed.error.flatten());
        }
        const { url, sessionId } = parsed.data as { url: string; sessionId?: string };
        const r = await this.jobExtract.extract(url);
        if (!r.ok) return r;
        this.logger.log(`extract 결과: ${r.content}`);
        // LLM 요약(텍스트/JSON)을 추가로 생성하여 프리뷰 품질 개선
        let summary: string | undefined;
        let summaryJson: import('./job-extract.service').JobPostSummary | undefined;
        try {
            summary = await this.jobExtract.summarizeJobPost(r.content);
        } catch {
            summary = undefined;
        }
        try {
            summaryJson = await this.jobExtract.summarizeJobPostJson(r.content);
        } catch {
            summaryJson = undefined;
        }
        try {
            if (sessionId) {
                this.ai.setJobContext(sessionId, {
                    url,
                    title: r.ok ? r.title : undefined,
                    company: r.ok ? r.company : undefined,
                    summary: summary,
                });
            }
        } catch {}
        return { ...r, summary, summaryJson };
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
        const params: CreateFollowupsParams = parsed.data as any;
        const sessionId: string | undefined = (parsed.data as any).sessionId;
        return this.ai.createFollowups(params, { sessionId });
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
                // 세션-이력서 연결 보장
                await this.db.execute(
                    `INSERT INTO interview_sessions (session_id, user_id, external_key)
                     VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE 
                       external_key = IFNULL(external_key, VALUES(external_key))`,
                    [sessionId, userId, resumeFileId],
                );
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

    // 세션 상태 조회: 결과 페이지/세션 가드에서 빠른 분기용
    @Get(':sessionId/status')
    async getStatus(@Param('sessionId') sessionId: string, @Req() req: any) {
        const userId = Number(req?.user_idx ?? req?.user?.idx);
        if (!userId) throw new BadRequestException('unauthorized');

        const sess = await this.db.query<{ user_id: number; ended_at: Date | null }>(
            `SELECT user_id, ended_at FROM interview_sessions WHERE session_id = ?`,
            [sessionId],
        );
        if (!sess.length || sess[0].user_id !== userId) {
            return { ok: true, exists: false, hasReport: false };
        }
        const rep = await this.db.query<{ c: number }>(
            `SELECT COUNT(*) AS c FROM interview_reports WHERE session_id = ? AND user_id = ?`,
            [sessionId, userId],
        );
        return {
            ok: true,
            exists: true,
            hasReport: (rep[0]?.c || 0) > 0,
            endedAt: sess[0].ended_at ?? null,
        };
    }

    /**
     * 세션 이탈/취소 시 서버 리소스 정리 (sendBeacon 등으로 호출)
     * - 소유자만 취소 가능
     * - 리포트가 이미 생성된 세션은 삭제하지 않고 종료만 표시
     */
    @Post(':sessionId/cancel')
    async cancelSession(
        @Param('sessionId') sessionId: string,
        @Req() req: any,
        @Body() _body?: any,
    ) {
        this.logger.log(`POST /ai/${sessionId}/cancel`);
        const userId = Number(req?.user_idx ?? req?.user?.idx);
        if (!userId) throw new BadRequestException('unauthorized');

        // 세션 존재/소유자 확인
        const sess = await this.db.query<{ user_id: number }>(
            `SELECT user_id FROM interview_sessions WHERE session_id = ?`,
            [sessionId],
        );
        if (!sess.length) {
            // 이미 없어도 OK (idempotent)
            return { ok: true, deleted: false, missing: true };
        }
        if (sess[0].user_id !== userId) {
            // 소유자가 아니면 무시(정보 노출 방지)
            return { ok: true, deleted: false };
        }

        // 이미 리포트가 생성된 경우 삭제하지 않음
        const rep = await this.db.query<{ c: number }>(
            `SELECT COUNT(*) AS c FROM interview_reports WHERE session_id = ? AND user_id = ?`,
            [sessionId, userId],
        );
        if ((rep[0]?.c || 0) > 0) {
            await this.db.execute(
                `UPDATE interview_sessions SET ended_at = NOW() WHERE session_id = ?`,
                [sessionId],
            );
            this.ai.clearSessionContext(sessionId);
            return { ok: true, deleted: false, finalized: true };
        }

        // 세션 삭제 → 연관 데이터는 FK ON DELETE CASCADE로 정리
        await this.db.execute(
            `DELETE FROM interview_sessions WHERE session_id = ? AND user_id = ?`,
            [sessionId, userId],
        );
        this.ai.clearSessionContext(sessionId);
        return { ok: true, deleted: true };
    }
}
