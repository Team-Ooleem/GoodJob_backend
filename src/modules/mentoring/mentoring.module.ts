import { Module } from '@nestjs/common';
import { MentoringProductsController } from './mentoring-products.controller';
import { MentorsController } from './mentors.controller';
import { MenteesController } from './mentees.controller';
import { MentoringApplicationsController } from './mentoring-applications.controller';
import { MentorApplicationsController } from './mentor-applications.controller';
import { MentoringService } from './mentoring.service';
import { DatabaseModule } from '@/database/database.module';

@Module({
    imports: [DatabaseModule],
    controllers: [
        MentoringProductsController,
        MentorsController,
        MenteesController,
        MentoringApplicationsController,
        MentorApplicationsController,
    ],
    providers: [MentoringService],
    exports: [MentoringService],
})
export class MentoringModule {}
