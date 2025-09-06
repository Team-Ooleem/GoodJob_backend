// src/modules/interview/interview.controller.ts
import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import {
    AiService,
    type QuestionResult,
    type FollowupsResult,
    type CreateFollowupsParams,
} from './interview.service';

// ===== 요청 바디 스키마 & 타입 =====
const CreateQuestionBodySchema = z.object({
    resumeSummary: z.string().min(10),
});

const CreateFollowupsBodySchema = z.object({
    originalQuestion: z.object({
        id: z.string(),
        text: z.string().min(5),
    }),
    answer: z.string().min(5),
});

@Controller('ai')
export class AiController {
    constructor(private readonly ai: AiService) {}

    // POST /api/ai/question
    @Post('question')
    async createQuestion(@Body() body: unknown): Promise<QuestionResult> {
        const parsed = CreateQuestionBodySchema.safeParse(body);
        if (!parsed.success) {
            throw new BadRequestException(parsed.error.flatten());
        }
        const { resumeSummary } = parsed.data;
        return this.ai.createQuestion(resumeSummary);
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
