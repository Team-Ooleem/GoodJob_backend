import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TTSController } from './tts.controller';
import { TTSService } from './tts.service';

@Module({
    imports: [
        ConfigModule, // 환경변수 사용을 위해 필요
    ],
    controllers: [TTSController],
    providers: [TTSService],
    exports: [TTSService], // 다른 모듈에서 TtsService를 사용할 수 있도록 export
})
export class TTSModule {}
