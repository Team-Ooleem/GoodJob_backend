import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
    imports: [DatabaseModule],
    controllers: [ProfileController],
    providers: [ProfileService],
    exports: [ProfileService],
})
export class ProfileModule {}
