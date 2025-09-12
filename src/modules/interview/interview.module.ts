import { Module } from '@nestjs/common';
import { AiController } from './interview.controller';
import { AiService } from './interview.service';
import { ResumeFileModule } from '@/modules/resume-file/resume-file.module';

@Module({
    imports: [ResumeFileModule],
    controllers: [AiController],
    providers: [AiService],
})
export class AiModule {} // ← 반드시 'export class AiModule' 여야 합니다.
