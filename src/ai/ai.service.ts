import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class AiService {
    private client: OpenAI;

    constructor(private readonly configService: ConfigService) {
        // OpenAI SDK 인스턴스 생성 (환경변수 키로 인증)
        this.client = new OpenAI({
            apiKey: this.configService.get<string>('app.openai.apiKey'),
        });
    }

    // 프론트에서 받은 이력서 요약 텍스트를 인자로 받음
    async createQuestion(resumeSummary: string) {
        // 프롬프트 구성
        // system : 면접관 역할+출력형식(json) 강제
        const system =
            '너는 채용 면접관이다. 반드시 {"question":{"id","text"}} 형식의 JSON 한 개만 출력해라. ' +
            '불필요한 말/주석/설명 금지. id는 문자열, text는 한국어 질문 문장 하나.';
        // user : 이력서 요약 + 출력 요구사항
        const user =
            `이력서 요약:\n${resumeSummary}\n\n` +
            `요구사항:\n- 질문 1개만 출력\n- 너무 일반적인 질문 금지\n- 직무/경험/성과 기반`;

        // 모델 호출
        const r = await this.client.chat.completions.create({
            model: 'gpt-4o-mini',
            // 창의성 ↓, 일관성/형식 안정성 ↑
            temperature: 0.2,
            //   모델이 순수 JSON만 내도록 강제
            response_format: { type: 'json_object' },
            // messages: 위에서 만든 system/user 프롬프트 적용
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
        });

        // 모델 응답의 첫번째 choice에서 content를 꺼냄
        const content = r.choices[0]?.message?.content ?? '{}';
        let json: any;
        // JSON.parse 시도 → 실패 시 502류 에러로 처리하게끔 예외 발생
        try {
            json = JSON.parse(content);
        } catch {
            throw new Error('AI 응답 JSON 파싱 실패');
        }

        // 모델이 id를 숫자로 내보내는 등 형식이 어긋날 수 있어서 문자열로 강제 변환
        if (json?.question) {
            json.question = {
                id: String(json.question.id ?? 'q-1'),
                text: String(json.question.text ?? ''),
            };
        }
        // 메인 데이터: { question: { id, text } }
        return { ...json, usage: r.usage ?? null, requestId: r.id };
    }

    // 꼬리질문 생성
    async createFollowups(params: {
        originalQuestion: { id: string; text: string };
        answer: string;
    }) {
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

        const content = r.choices[0]?.message?.content ?? '{"followups": []}';
        let json: any;
        try {
            json = JSON.parse(content);
        } catch {
            throw new Error('AI 응답 JSON 파싱 실패');
        }

        // 결과 보정: 배열 길이를 정확히 1로 맞춤
        let list = Array.isArray(json?.followups) ? json.followups : [];
        if (list.length > 1) list = [list[0]];

        json.followups = list.map((f: any, i: number) => ({
            id: String(f?.id ?? `f-${i + 1}`),
            parentId: String(f?.parentId ?? originalQuestion.id),
            text: String(f?.text ?? ''),
            reason: String(f?.reason ?? ''),
        }));

        return { ...json, usage: r.usage ?? null, requestId: r.id };
    }
}
