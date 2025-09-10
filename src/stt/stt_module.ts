import { Module } from '@nestjs/common';
import { STTController } from './stt_controller';
import { STTService } from './stt_service';
import { GoogleSpeechProvider } from './providers/google-speech';
import { GcsService } from '../lib/gcs';
import { DatabaseService } from '../database/database.service';

@Module({
    controllers: [STTController],
    providers: [STTService, GoogleSpeechProvider, GcsService, DatabaseService],
    exports: [STTService],
})
export class STTModule {}
