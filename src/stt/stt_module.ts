import { Module } from '@nestjs/common';
import { STTController } from './stt_controller';
import { STTService } from './stt_service';
import { GoogleSpeechProvider } from './providers/google-speech';
import { STTSessionService } from './services/stt-seesion.service';
import { STTMessageService } from './services/stt-message.service';
import { STTUtilService } from './services/stt-util.service';
import { DatabaseModule } from '../database/database.module';
import { AudioDurationService } from './services/audio-duration.service';
import { GcsService } from '../lib/gcs';
import { PynoteService } from './providers/pynote.service';
import { TranscribeContextUseCase } from './services/transcribe-context.use-case';
import { AudioChunkProcessorService } from './services/audio-chunk-processor.service';
import { SessionFinalizerService } from './services/session-finalizer.service';

@Module({
    imports: [DatabaseModule],
    controllers: [STTController],
    providers: [
        STTService,
        GoogleSpeechProvider,
        STTSessionService,
        STTMessageService,
        STTUtilService,
        AudioDurationService,
        GcsService,
        PynoteService,
        TranscribeContextUseCase,
        AudioChunkProcessorService,
        SessionFinalizerService,
    ],
    exports: [
        STTService,
        TranscribeContextUseCase,
        AudioChunkProcessorService,
        SessionFinalizerService,
    ],
})
export class STTModule {}
