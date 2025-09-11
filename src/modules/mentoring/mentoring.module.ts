import { Module } from '@nestjs/common';
import { MentoringProductsController } from './mentoring-products.controller';
import { MentoringService } from './mentoring.service';

@Module({
    controllers: [MentoringProductsController],
    providers: [MentoringService],
    exports: [MentoringService],
})
export class MentoringModule {}
