// stt.module.ts 수정
import { Module } from '@nestjs/common';
import { STTController } from './stt_controller';
import { STTService } from './stt_service';
import { GcsService } from '../lib/gcs';
import { DatabaseService } from '../database/database.service';
import { STTSessionService } from './services/stt-seesion.service';
import { STTMessageService } from './services/stt-message.service';
import { STTUtilService } from './services/stt-util.service';
import { AudioDurationService } from './services/audio-duration.service';
import { GoogleSpeechProvider } from './providers/google-speech';
import { PynoteService } from './providers/pynote.service';
import { ConfigModule } from '@nestjs/config';
import { CanvasModule } from '../modules/coaching-resume/canvas.modeule';

@Module({
    imports: [ConfigModule, CanvasModule],
    controllers: [STTController],
    providers: [
        STTService,
        GcsService,
        DatabaseService,
        STTSessionService,
        STTMessageService,
        STTUtilService,
        AudioDurationService,
        GoogleSpeechProvider,
        PynoteService,
    ],
    exports: [STTService],
})
export class STTModule {}
