import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseService } from './database.service';
import { DatabaseController } from './database.controller';
import databaseConfig from './database.config';

@Module({
    imports: [ConfigModule.forFeature(databaseConfig)],
    controllers: [DatabaseController],
    providers: [DatabaseService],
    exports: [DatabaseService],
})
export class DatabaseModule {}
