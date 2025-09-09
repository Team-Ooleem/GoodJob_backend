import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AvatarController } from './avatar.controller';
import { AvatarService } from './avatar.service';
import { TTSModule } from '@/tts/tts.module';

@Module({
    imports: [ConfigModule, TTSModule],
    controllers: [AvatarController],
    providers: [AvatarService],
})
export class AvatarModule {}
