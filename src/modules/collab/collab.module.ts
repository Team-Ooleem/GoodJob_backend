import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { CollabGateway } from './collab.gateway';
import { CanvasModule } from '../coaching-resume/canvas.modeule';

@Module({
    imports: [DatabaseModule, CanvasModule],
    providers: [CollabGateway],
})
export class CollabModule {}
