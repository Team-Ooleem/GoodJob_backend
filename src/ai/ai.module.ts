import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}   // ← 반드시 'export class AiModule' 여야 합니다.
