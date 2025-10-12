import { Module } from '@nestjs/common';
import { ResumeFileService } from './resume-file.service';
import { ResumeFileController } from './resume-file.controller';
import { DatabaseService } from '@/database/database.service';
import { AppConfigService } from '@/config/config.service';
import { OpenAIService } from '@/modules/openai/openai.service';
import { QdrantService } from '@/lib/qdrant.service';

@Module({
    controllers: [ResumeFileController],
    providers: [ResumeFileService, DatabaseService, AppConfigService, OpenAIService, QdrantService],
    exports: [ResumeFileService],
})
export class ResumeFileModule {}
