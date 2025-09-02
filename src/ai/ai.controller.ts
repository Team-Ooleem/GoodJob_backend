import { Body, Controller, Post } from '@nestjs/common';
import { AiService } from './ai.service';
import { z } from 'zod';

const BodySchema = z.object({
  resumeSummary: z.string().min(10),
});

@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('question')
  async createQuestion(@Body() body: any) {
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return { error: parsed.error.flatten() };
    }
    const { resumeSummary } = parsed.data;
    return this.ai.createQuestion(resumeSummary);
  }
}
