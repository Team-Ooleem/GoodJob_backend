import { Module } from '@nestjs/common';
import { ResumeFileService } from './resume-file.service';
import { ResumeFileController } from './resume-file.controller';
import { DatabaseService } from '@/database/database.service';
import { AppConfigService } from '@/config/config.service';
import { OpenAIService } from '@/modules/openai/openai.service';

@Module({
    controllers: [ResumeFileController],
    providers: [ResumeFileService, DatabaseService, AppConfigService, OpenAIService],
    exports: [ResumeFileService],
})
export class ResumeFileModule {}
