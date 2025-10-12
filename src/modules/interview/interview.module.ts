import { Module } from '@nestjs/common';
import { AiController } from './interview.controller';
import { AiService } from './interview.service';
import { JobExtractService } from './job-extract.service';
import { ResumeFileModule } from '@/modules/resume-file/resume-file.module';
import { DatabaseService } from '@/database/database.service';
import { QdrantService } from '@/lib/qdrant.service';

@Module({
    imports: [ResumeFileModule],
    controllers: [AiController],
    providers: [AiService, DatabaseService, JobExtractService, QdrantService],
})
export class AiModule {} // ← 반드시 'export class AiModule' 여야 합니다.
