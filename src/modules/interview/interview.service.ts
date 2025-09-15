// src/modules/interview/interview.service.ts
import { Injectable, Logger } from '@nestjs/common';
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

// ===== 분석 결과 DTOs =====
export interface ContentAnalysis {
    content_score: number; // 0~100
    reasoning: string[]; // 3~5 bullets
    star: { situation?: string; task?: string; action?: string; result?: string };
    improvements: string[]; // 3 bullets
}

export interface ContextLink {
    answer_span: string;
    resume_ref?: string;
    similarity?: number; // 0~1
    explanation?: string;
}

export interface ContextAnalysis {
    context_score: number; // 0~100
    links: ContextLink[];
    consistency: { contradiction: boolean; notes?: string };
}

export interface AnalysisResult {
    content: ContentAnalysis;
    context: ContextAnalysis;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
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

// ===== Zod helpers for robust coercion =====
const boolish = z.preprocess((v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (['true', 'yes', 'y', '1', 't'].includes(s)) return true;
        if (['false', 'no', 'n', '0', 'f'].includes(s)) return false;
    }
    return v;
}, z.boolean());

const numberish = z.preprocess((v) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
        const n = Number(v);
        return Number.isFinite(n) ? n : v;
    }
    return v;
}, z.number());

const score100 = numberish.transform((n) => Math.max(0, Math.min(100, Math.round(n))));
const sim01 = numberish.transform((n) => Math.max(0, Math.min(1, Number(n))));

// 내용 분석 스키마(타입 강제 + 관용적 입력 허용)
const ContentAnalysisSchema = z.object({
    content_score: score100,
    reasoning: z.array(z.string()).min(1).max(5),
    star: z.object({
        situation: z.string().optional(),
        task: z.string().optional(),
        action: z.string().optional(),
        result: z.string().optional(),
    }),
    improvements: z.array(z.string()).min(1).max(3),
});

// 맥락 분석 스키마(타입 강제 + 관용적 입력 허용)
const ContextAnalysisSchema = z.object({
    context_score: score100,
    links: z
        .array(
            z.object({
                answer_span: z.string().min(1),
                resume_ref: z.string().optional(),
                similarity: sim01.optional(),
                explanation: z.string().optional(),
            }),
        )
        .min(1),
    consistency: z.object({
        contradiction: boolish,
        notes: z.string().optional(),
    }),
});

/** ===== Service ===== */
@Injectable()
export class AiService {
    private client: OpenAI;
    private readonly logger = new Logger(AiService.name);

    constructor(private readonly configService: AppConfigService) {
        this.client = new OpenAI({ apiKey: this.configService.openai.apiKey });
        const key = this.configService.openai.apiKey || '';
        this.logger.log(`OpenAI 초기화: apiKey set=${key ? 'yes' : 'no'}, len=${key.length}`);
    }

    // 면접 질문 1개 생성
    async createQuestion(resumeSummary: string): Promise<QuestionResult> {
        this.logger.log(`createQuestion 시작: summaryLen=${resumeSummary?.length ?? 0}`);
        const system =
            '너는 채용 면접관이다. 반드시 {"question":{"id","text"}} 형식의 JSON 한 개만 출력해라. ' +
            '불필요한 말/주석/설명 금지. id는 문자열, text는 한국어 질문 문장 하나.';
        const user =
            `이력서 요약:\n${resumeSummary}\n\n` +
            `요구사항:\n- 질문 1개만 출력\n- 너무 일반적인 질문 금지\n- 직무/경험/성과 기반`;

        let r;
        try {
            r = await this.client.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0.2,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
            });
        } catch (e: any) {
            this.logger.error(`createQuestion OpenAI 오류: ${e?.message}`, e?.stack);
            throw e;
        }

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

        const result = {
            question: dto,
            requestId: r.id,
            usage: r.usage ?? null,
        };
        this.logger.log(
            `createQuestion 완료: id=${dto.id}, usage=${JSON.stringify(r.usage || null)}`,
        );
        return result;
    }

    // 꼬리질문 1개 생성
    async createFollowups(params: CreateFollowupsParams): Promise<FollowupsResult> {
        const { originalQuestion, answer } = params;
        this.logger.log(
            `createFollowups 시작: qid=${originalQuestion?.id}, qLen=${originalQuestion?.text?.length ?? 0}, aLen=${answer?.length ?? 0}`,
        );

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

        let r;
        try {
            r = await this.client.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0.2,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
            });
        } catch (e: any) {
            this.logger.error(`createFollowups OpenAI 오류: ${e?.message}`, e?.stack);
            throw e;
        }

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

        const res: FollowupsResult = {
            followups: [dto] as [FollowupDto],
            requestId: r.id,
            usage: r.usage ?? null,
        };
        this.logger.log(
            `createFollowups 완료: id=${dto.id}, usage=${JSON.stringify(r.usage || null)}`,
        );
        return res;
    }

    // ====== NEW: 내용(Content) 분석 ======
    async analyzeContent(answer: string): Promise<ContentAnalysis> {
        const t0 = Date.now();
        this.logger.log(`analyzeContent 시작: aLen=${answer?.length ?? 0}`);
        const system =
            '너는 채용 면접 답변을 평가하는 심사관이다. ' +
            '반드시 {"content_score","reasoning","star":{"situation","task","action","result"},"improvements":[]} 형식의 JSON만 출력한다. ' +
            'content_score는 0~100 정수. reasoning은 근거 bullet 3~5개, improvements는 개선 팁 3개. 불필요한 말 금지.';
        const user =
            `지원자 답변:\n${answer}\n\n요구사항:\n` +
            `- 질문 적합성, 구체성(수치/사례), 논리구성(STAR)을 종합해 content_score 산정\n` +
            `- STAR는 채워질 수 있는 항목만 채워라(없으면 생략 가능)\n` +
            `- improvements는 행동지침 톤으로 간결하게`;

        let r;
        try {
            r = await this.client.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0.2,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
            });
        } catch (e: any) {
            this.logger.error(`analyzeContent OpenAI 오류: ${e?.message}`, e?.stack);
            throw e;
        }
        const raw = safeJsonParse(r.choices[0]?.message?.content ?? '{}');
        const parsed = ContentAnalysisSchema.safeParse(raw);
        if (!parsed.success) throw new Error(`내용 분석 JSON 오류: ${parsed.error.message}`);
        const data = parsed.data;
        this.logger.log(
            `analyzeContent 완료: score=${data.content_score}, durationMs=${Date.now() - t0}`,
        );
        return data;
    }

    // 간단한 문장 분할기
    private splitSentences(s: string): string[] {
        return (s || '')
            .split(/(?<=[\.\!\?]|다\.|요\.)\s+/)
            .map((t) => t.trim())
            .filter(Boolean);
    }

    // ====== NEW: 맥락(Context) 분석 ======
    async analyzeContext(
        answer: string,
        resumeText: string,
        prevClaims: string[] = [],
    ): Promise<ContextAnalysis> {
        const t0 = Date.now();
        const ansSents = this.splitSentences(answer).slice(0, 8);
        const resSents = this.splitSentences(resumeText).slice(0, 200);
        this.logger.log(
            `analyzeContext 시작: ansSents=${ansSents.length}, resSents=${resSents.length}`,
        );
        if (ansSents.length === 0 || resSents.length === 0) {
            return { context_score: 0, links: [], consistency: { contradiction: false } };
        }

        // 임베딩: 문장 단위
        const embModel = 'text-embedding-3-small';
        let ansEmb, resEmb;
        try {
            [ansEmb, resEmb] = await Promise.all([
                this.client.embeddings.create({ model: embModel, input: ansSents }),
                this.client.embeddings.create({ model: embModel, input: resSents }),
            ]);
        } catch (e: any) {
            this.logger.error(`analyzeContext Embeddings 오류: ${e?.message}`, e?.stack);
            throw e;
        }

        const ansVecs: number[][] = ansEmb.data.map((d: any) => d.embedding as number[]);
        const resVecs: number[][] = resEmb.data.map((d: any) => d.embedding as number[]);

        const cosine = (a: number[], b: number[]) => {
            let dot = 0,
                na = 0,
                nb = 0;
            const n = Math.min(a.length, b.length);
            for (let i = 0; i < n; i++) {
                const ai = a[i];
                const bi = b[i];
                dot += ai * bi;
                na += ai * ai;
                nb += bi * bi;
            }
            return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
        };

        const links: ContextLink[] = [];
        for (let i = 0; i < ansSents.length; i++) {
            let bestIdx = 0,
                bestSim = -1;
            for (let j = 0; j < resVecs.length; j++) {
                const sim = cosine(ansVecs[i], resVecs[j]);
                if (sim > bestSim) {
                    bestSim = sim;
                    bestIdx = j;
                }
            }
            links.push({
                answer_span: ansSents[i],
                resume_ref: resSents[bestIdx],
                similarity: Number(bestSim.toFixed(3)),
            });
        }

        const system =
            '너는 면접 답변이 이력서와 얼마나 잘 연결되는지 평가하는 심사관이다. ' +
            '반드시 {"context_score","links":[{"answer_span","resume_ref","similarity","explanation"}],"consistency":{"contradiction","notes"}} 형식의 JSON만 출력한다. ' +
            'context_score는 0~100 정수. explanation은 한글로 간결하게.';
        const user =
            `연결 후보(Top-1 매칭들, JSON):\n${JSON.stringify(links, null, 2)}\n\n` +
            `이전 문항 요지(있으면 모순 여부 판단에 참고):\n${prevClaims.join('\n') || '(없음)'}\n\n` +
            `평가 기준:\n- 이력서의 경력/역할/성과/기술과 직접 연결되는 답변일수록 가점\n- 유사도(similarity)가 높고 근거가 명확할수록 가점\n- 이전 문항들과 모순되면 감점`;

        let r;
        try {
            r = await this.client.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0.2,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
            });
        } catch (e: any) {
            this.logger.error(`analyzeContext OpenAI 오류: ${e?.message}`, e?.stack);
            throw e;
        }
        const raw = safeJsonParse(r.choices[0]?.message?.content ?? '{}') as any;

        // 관용적 정규화(LLM이 문자열/숫자 문자열을 주는 경우 보정)
        const normalizeContext = (obj: any) => {
            try {
                const out: any = { ...(obj || {}) };
                // 점수
                if (out.context_score != null && typeof out.context_score === 'string') {
                    const n = Number(out.context_score);
                    if (Number.isFinite(n)) out.context_score = n;
                }
                // 링크 유사도
                if (Array.isArray(out.links)) {
                    out.links = out.links.map((l: any) => {
                        const item = { ...(l || {}) };
                        if (item.similarity != null && typeof item.similarity === 'string') {
                            const n = Number(item.similarity);
                            if (Number.isFinite(n)) item.similarity = n;
                        }
                        return item;
                    });
                }
                // 모순 여부(boolean 문자열 처리)
                if (out.consistency && typeof out.consistency === 'object') {
                    const v = out.consistency.contradiction;
                    if (typeof v === 'string') {
                        const s = v.trim().toLowerCase();
                        if (['true', 'yes', 'y', '1', 't'].includes(s))
                            out.consistency.contradiction = true;
                        else if (['false', 'no', 'n', '0', 'f', 'none'].includes(s))
                            out.consistency.contradiction = false;
                    }
                }
                return out;
            } catch {
                return obj;
            }
        };

        const norm = normalizeContext(raw);
        const parsed = ContextAnalysisSchema.safeParse(norm);
        if (!parsed.success) {
            this.logger.warn(`analyzeContext 원시 JSON: ${JSON.stringify(raw)}`);
            throw new Error(`맥락 분석 JSON 오류: ${parsed.error.message}`);
        }
        const data = parsed.data;
        this.logger.log(
            `analyzeContext 완료: score=${data.context_score}, links=${data.links?.length ?? 0}, durationMs=${Date.now() - t0}`,
        );
        return data;
    }

    // ====== NEW: 통합 분석 ======
    async analyzeAnswer(
        answer: string,
        resumeSummaryOrFull: string,
        prevClaims: string[] = [],
    ): Promise<AnalysisResult> {
        const t0 = Date.now();
        this.logger.log(
            `analyzeAnswer 시작: aLen=${answer?.length ?? 0}, resumeLen=${resumeSummaryOrFull?.length ?? 0}, prevClaims=${prevClaims?.length ?? 0}`,
        );
        const [content, context] = await Promise.all([
            this.analyzeContent(answer),
            this.analyzeContext(answer, resumeSummaryOrFull, prevClaims),
        ]);
        const res = { content, context, usage: null };
        this.logger.log(
            `analyzeAnswer 완료: content=${content.content_score}, context=${context.context_score}, durationMs=${Date.now() - t0}`,
        );
        return res;
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
