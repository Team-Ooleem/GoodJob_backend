import { Module } from '@nestjs/common';
import { MentoringProductsController } from './mentoring-products.controller';
import { MentorsController } from './mentors.controller';
import { MenteesController } from './mentees.controller';
import { MentoringService } from './mentoring.service';

@Module({
    controllers: [MentoringProductsController, MentorsController, MenteesController],
    providers: [MentoringService],
    exports: [MentoringService],
})
export class MentoringModule {}
