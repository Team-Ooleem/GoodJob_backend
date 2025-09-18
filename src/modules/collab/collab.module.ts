import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { CollabGateway } from './collab.gateway';

@Module({
    imports: [DatabaseModule],
    providers: [CollabGateway],
})
export class CollabModule {}
