import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import { OpenAIService } from '../../openai/openai.service';

// 문항별 텍스트 분석 로우 타입
export type ContentAnalysisRow = {
    content_score: number; // 0~100
    reasoning?: string[];
    improvements?: string[];
    star?: { situation?: string; task?: string; action?: string; result?: string };
};

export type ContextAnalysisRow = {
    context_score: number; // 0~100
    links?: Array<{
        answer_span: string;
        resume_ref?: string;
        similarity?: number;
        explanation?: string;
    }>;
    consistency?: { contradiction: boolean; notes?: string };
};

export type TextAnalysisResult = {
    content_avg100: number; // 문항별 content_score 평균(0-100)
    context_avg100: number; // 문항별 context_score 평균(0-100)
    overall_llm10: number; // LLM 텍스트 종합(0-10)
    top_reasons?: string[]; // 근거 bullet 상위(중복 제거)
    top_improvements?: string[]; // 개선 팁 상위(중복 제거)
    evidence_links?: Array<{
        answer_span: string;
        resume_ref?: string;
        similarity?: number;
        explanation?: string;
    }>;
    contradiction: boolean;
};

@Injectable()
export class TextAnalysisService {
    constructor(
        private readonly db: DatabaseService,
        private readonly openai: OpenAIService,
    ) {}

    // DB에서 문항별 Content/Context 분석 불러오기
    async getPerQuestionTextAnalyses(sessionId: string): Promise<
        Array<{
            questionId: string;
            questionText?: string;
            content?: ContentAnalysisRow;
            context?: ContextAnalysisRow;
        }>
    > {
        // questions와 조인하여 order_no 기준 정렬, 없으면 question_id 정렬 폴백
        const rows = await this.db.query<any>(
            `SELECT iaa.question_id, iaa.content_analysis_json, iaa.context_analysis_json, q.order_no, q.text AS question_text
               FROM interview_answer_analyses iaa
          LEFT JOIN questions q
                 ON q.session_id = iaa.session_id AND q.question_id = iaa.question_id
              WHERE iaa.session_id = ?
           ORDER BY q.order_no ASC, iaa.question_id ASC`,
            [sessionId],
        );
        const out: Array<{
            questionId: string;
            questionText?: string;
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
            out.push({
                questionId: String(r.question_id),
                questionText: r?.question_text != null ? String(r.question_text) : undefined,
                content: c,
                context: k,
            });
        }
        return out;
    }

    // 텍스트 분석 집계
    aggregateTextAnalyses(
        items: Array<{
            questionId: string;
            content?: ContentAnalysisRow;
            context?: ContextAnalysisRow;
        }>,
    ): TextAnalysisResult {
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
            if (Array.isArray(it.context?.links)) links.push(...(it.context.links as any));
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

    // 세션 사용자 이력서 요약 조회
    async getResumeSummaryForSession(sessionId: string): Promise<string | null> {
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

    // OpenAI 기반 1분 자기소개 대본 생성
    async generateSelfIntroWithOpenAI(summary: string): Promise<string> {
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
}
