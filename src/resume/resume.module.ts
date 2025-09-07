import { Module } from '@nestjs/common';
import { ResumeController } from './resume.controller';
import { ResumeService } from './resume.service';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [DatabaseModule],
    controllers: [ResumeController],
    providers: [ResumeService],
    exports: [ResumeService],
})
export class ResumeModule {}
