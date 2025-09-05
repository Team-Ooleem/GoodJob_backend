import { Module } from '@nestjs/common';
import { CanvasService } from './canvas.service';
import { CanvasController } from './canvas.controller';
import { DatabaseService } from '../../database/database.service';

@Module({
    controllers: [CanvasController],
    providers: [CanvasService, DatabaseService],
})
export class CanvasModule {}
