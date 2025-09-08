// src/modules/interview/interview.service.ts
import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { z } from 'zod';
import { AppConfigService } from '@/config/config.service';

/** ===== Public DTOs (컨트롤러/다른 서비스에서 재사용 가능) ===== */
export interface QuestionDto {
    id: string;
    text: string;
}
export interface FollowupDto {
    id: string;
    parentId: string;
    text: string;
    reason: string;
}
export interface QuestionResult {
    question: QuestionDto;
    requestId: string;
    usage: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    } | null;
}
export interface FollowupsResult {
    followups: [FollowupDto]; // 정확히 1개
    requestId: string;
    usage: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    } | null;
}

export interface CreateFollowupsParams {
    originalQuestion: { id: string; text: string };
    answer: string;
}

/** ===== Zod 스키마 (모델 JSON 응답 검증) ===== */
const QuestionJsonSchema = z.object({
    question: z.object({
        id: z.union([z.string(), z.number()]).transform((v) => String(v)),
        text: z.string().min(1),
    }),
});

// 1) 아이템 스키마를 분리
const FollowupItemSchema = z.object({
    id: z.union([z.string(), z.number()]).transform((v) => String(v)),
    parentId: z.union([z.string(), z.number()]).transform((v) => String(v)),
    text: z.string().min(1),
    reason: z.string().min(1),
});

// 2) 전체 응답 스키마 (transform 제거, 배열 그대로)
const FollowupsJsonSchema = z.object({
    followups: z.array(FollowupItemSchema).min(1),
});

/** ===== Service ===== */
@Injectable()
export class AiService {
    private client: OpenAI;

    constructor(private readonly configService: AppConfigService) {
        this.client = new OpenAI({ apiKey: this.configService.openai.apiKey });
    }

    // 면접 질문 1개 생성
    async createQuestion(resumeSummary: string): Promise<QuestionResult> {
        const system =
            '너는 채용 면접관이다. 반드시 {"question":{"id","text"}} 형식의 JSON 한 개만 출력해라. ' +
            '불필요한 말/주석/설명 금지. id는 문자열, text는 한국어 질문 문장 하나.';
        const user =
            `이력서 요약:\n${resumeSummary}\n\n` +
            `요구사항:\n- 질문 1개만 출력\n- 너무 일반적인 질문 금지\n- 직무/경험/성과 기반`;

        const r = await this.client.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.2,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
        });

        const content: string = r.choices[0]?.message?.content ?? '{}';
        const parsed = QuestionJsonSchema.safeParse(safeJsonParse(content));
        if (!parsed.success) {
            // 모델이 형식을 어겼을 때 502/500 계열로 핸들링하도록 예외
            throw new Error(`AI 응답 JSON 형식 오류: ${parsed.error.message}`);
        }

        const dto: QuestionDto = {
            id: parsed.data.question.id,
            text: parsed.data.question.text,
        };

        return {
            question: dto,
            requestId: r.id,
            usage: r.usage ?? null,
        };
    }

    // 꼬리질문 1개 생성
    async createFollowups(params: CreateFollowupsParams): Promise<FollowupsResult> {
        const { originalQuestion, answer } = params;

        const system =
            '너는 까다롭지만 공정한 면접관이다. 반드시 {"followups":[{ "id","parentId","text","reason" }]} 형식의 JSON만 출력해라. ' +
            '항목 수는 정확히 1개여야 한다. 각 필드는 문자열이며 한국어로 작성하라. ' +
            '답변의 빈틈/가정/근거 부족/정량적 수치 검증 포인트를 파고들어라. ' +
            'parentId는 원 질문의 id와 동일하게 설정해라. 불필요한 말/주석/설명 금지.';

        const user = `원 질문: "${originalQuestion.text}" (id: ${originalQuestion.id})
지원자 답변: "${answer}"

요구사항:
- 후속 질문 1개만 출력(정확히 1개)
- 각 항목: {id, parentId, text, reason}
- text는 구체적이고 검증가능한 팩트를 요구할 것`;

        const r = await this.client.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.2,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
        });

        const content: string = r.choices[0]?.message?.content ?? '{"followups": []}';
        const raw = safeJsonParse(content);

        // 모델이 parentId를 엉뚱하게 넣어줄 수 있으므로 보정 로직 포함
        const parsed = FollowupsJsonSchema.safeParse(raw);
        if (!parsed.success) {
            throw new Error(`AI 응답 JSON 형식 오류: ${parsed.error.message}`);
        }

        const one = parsed.data.followups[0];
        const dto: FollowupDto = {
            id: one.id,
            parentId: one.parentId || originalQuestion.id,
            text: one.text,
            reason: one.reason,
        };

        return {
            followups: [dto],
            requestId: r.id,
            usage: r.usage ?? null,
        };
    }
}

/** ===== Helpers ===== */
function safeJsonParse(text: string): unknown {
    // JSON.parse는 unknown으로 받아 Zod로 검증 → any 전파 차단
    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new Error('AI 응답 JSON 파싱 실패');
    }
}
