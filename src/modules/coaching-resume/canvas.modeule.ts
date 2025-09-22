import { Module } from '@nestjs/common';
import { CanvasService } from './canvas.service';
import { CanvasController } from './canvas.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
    imports: [DatabaseModule],
    controllers: [CanvasController],
    providers: [CanvasService],
    exports: [CanvasService],
})
export class CanvasModule {}
