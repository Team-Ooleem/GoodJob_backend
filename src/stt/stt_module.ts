import { Module } from '@nestjs/common';
import { STTController } from './stt_controller';
import { STTService } from './stt_service';
import { GoogleSpeechProvider } from './providers/google-speech';
import { STTSessionService } from './services/stt-seesion.service';
import { STTMessageService } from './services/stt-message.service';
import { STTUtilService } from './services/stt-util.service';
import { DatabaseModule } from '../database/database.module';
import { GcsService } from '../lib/gcs';

@Module({
    imports: [DatabaseModule], // GcsService 제거
    controllers: [STTController],
    providers: [
        STTService,
        GoogleSpeechProvider,
        STTSessionService,
        STTMessageService,
        STTUtilService,
        GcsService, // providers에 추가
    ],
    exports: [STTService],
})
export class STTModule {}
