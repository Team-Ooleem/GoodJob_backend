// src/modules/interview/interview.controller.ts
import { BadRequestException, Body, Controller, Post, Req } from '@nestjs/common';
import { ResumeFileService } from '@/modules/resume-file/resume-file.service';
import { z } from 'zod';
import {
    AiService,
    type QuestionResult,
    type FollowupsResult,
    type CreateFollowupsParams,
} from './interview.service';

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

@Controller('ai')
export class AiController {
    constructor(
        private readonly ai: AiService,
        private readonly resumeFiles: ResumeFileService,
    ) {}

    // POST /api/ai/question
    @Post('question')
    async createQuestion(@Body() body: unknown, @Req() req: any): Promise<QuestionResult> {
        const parsed = CreateQuestionBodySchema.safeParse(body);
        if (!parsed.success) {
            throw new BadRequestException(parsed.error.flatten());
        }
        const userId = Number((req as any).user_idx ?? (req as any).user?.idx);
        if (!userId) throw new BadRequestException('unauthorized');
        if ('resumeFileId' in parsed.data) {
            const summary = await this.resumeFiles.getSummaryById(parsed.data.resumeFileId, userId);
            if (!summary || summary.length < 10) {
                throw new BadRequestException('요약이 비어있습니다. 먼저 요약을 등록하세요.');
            }
            return this.ai.createQuestion(summary);
        }
        return this.ai.createQuestion(parsed.data.resumeSummary);
    }

    // POST /api/ai/followups
    @Post('followups')
    async createFollowups(@Body() body: unknown): Promise<FollowupsResult> {
        const parsed = CreateFollowupsBodySchema.safeParse(body);
        if (!parsed.success) {
            throw new BadRequestException(parsed.error.flatten());
        }
        // 스키마로 보장된 타입을 서비스 입력 DTO로 그대로 사용
        const params: CreateFollowupsParams = parsed.data;
        return this.ai.createFollowups(params);
    }
}
