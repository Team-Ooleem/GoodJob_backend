import { Body, Controller, Post } from '@nestjs/common';
// 실제로 OpenAI API 요청하는 서비스
import { AiService } from './ai.service';
// 요청 body가 올바른 형식인지 검사하기 위한 라이브러리
import { z } from 'zod';

// 요청 body에 반드시 'resumeSummary'라는 문자열이 있어야 하고, 최소 10자 이상이어야 함
// 예시 : { "resumeSummary": "백엔드 3년 NestJS 경험 있음" }
const BodySchema = z.object({
  resumeSummary: z.string().min(10),
});

// 꼬리질문 바디 검증
const FollowupBodySchema = z.object({
    originalQuestion: z.object({
      id: z.string(),
      text: z.string().min(5),
    }),
    answer: z.string().min(5),
  });

// /api/ai/... 이런 경로가 만들어짐
@Controller('ai')
export class AiController {
    // Aiservice를 DI(의존성 주입)받아서 내부 메소드에서 사용 가능
  constructor(private readonly ai: AiService) {}

// 라우트 경로 : POST /api/ai/question
  @Post('question')
  // @Body() → 요청의 body(JSON)를 받아옴
  async createQuestion(@Body() body: any) {
    // safeParse() → zod로 유효성 검사 실행, 
    // 실패하면 { error: ... } JSON 반환, 성공하면 { resumeSummary } 꺼냄
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return { error: parsed.error.flatten() };
    }
    const { resumeSummary } = parsed.data;
    // this.ai.createQuestion(resumeSummary) 호출 -> openAI 실행 -> 질문 생성 후 결과 반환
    return this.ai.createQuestion(resumeSummary);
  }

  // 꼬리질문 API
  @Post('followups')
  async createFollowups(@Body() body: any) {
    const parsed = FollowupBodySchema.safeParse(body);
    if (!parsed.success) {
      return { error: parsed.error.flatten() };
    }
    return this.ai.createFollowups(parsed.data);
  }

  
}
