import { Module } from '@nestjs/common';
import { MentoringController } from './mentoring.controller';
import { MentoringService } from './mentoring.service';

@Module({
    controllers: [MentoringController],
    providers: [MentoringService],
    exports: [MentoringService],
})
export class MentoringModule {}

