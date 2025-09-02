import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class AiService {
  private client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  async createQuestion(resumeSummary: string) {
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

    const content = r.choices[0]?.message?.content ?? '{}';
    let json: any;
    try { json = JSON.parse(content); } catch { throw new Error('AI 응답 JSON 파싱 실패'); }

    if (json?.question) {
      json.question = {
        id: String(json.question.id ?? 'q-1'),
        text: String(json.question.text ?? ''),
      };
    }
    return { ...json, usage: r.usage ?? null, requestId: r.id };
  }
}
