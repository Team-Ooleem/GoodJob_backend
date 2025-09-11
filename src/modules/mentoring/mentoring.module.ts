import { Module } from '@nestjs/common';
import { MentoringProductsController } from './mentoring-products.controller';
import { MentorsController } from './mentors.controller';
import { MentoringService } from './mentoring.service';

@Module({
    controllers: [MentoringProductsController, MentorsController],
    providers: [MentoringService],
    exports: [MentoringService],
})
export class MentoringModule {}
