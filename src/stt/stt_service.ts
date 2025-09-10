import { Injectable, Logger } from '@nestjs/common';
import { GoogleSpeechProvider } from './providers/google-speech';
import { AudioProcessorUtil } from './utils/audio-processer';
import { TextProcessorUtil } from './utils/text_processor';
import { SpeechPatternsUtil } from './utils/speech-patterms';
import { TranscriptionResult } from './entities/transcription';
import { SpeakerSegment } from './entities/speaker-segment';

@Injectable()
export class STTService {
    private readonly logger = new Logger(STTService.name);

    constructor(private readonly googleSpeechProvider: GoogleSpeechProvider) {}

    async transcribeAudioBuffer(
        audioBuffer: Buffer,
        mimeType = 'audio/webm',
        sessionStartTimeOffset = 0,
        gcsUrl?: string,
    ): Promise<TranscriptionResult> {
        const base64Data = audioBuffer.toString('base64');
        return this.transcribeBase64Audio(base64Data, mimeType, sessionStartTimeOffset, gcsUrl);
    }

    async transcribeBase64Audio(
        base64Data: string,
        mimeType = 'audio/wav',
        sessionStartTimeOffset = 0,
        gcsUrl?: string,
    ): Promise<TranscriptionResult> {
        try {
            const audioData = this.prepareAudioData(base64Data, gcsUrl);
            const config = this.createAudioConfig(mimeType);
            const result = await this.googleSpeechProvider.transcribe(audioData, config, gcsUrl);

            return this.adjustTimings(result, sessionStartTimeOffset);
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`STT 변환 실패: ${msg}`);
            throw new Error(`STT 변환 실패: ${msg}`);
        }
    }

    normalizeTimings(speakers: SpeakerSegment[], actualDuration: number): SpeakerSegment[] {
        return TextProcessorUtil.normalizeTimings(speakers, actualDuration);
    }

    async testConnection() {
        return this.googleSpeechProvider.testConnection();
    }

    createSampleResult() {
        return this.googleSpeechProvider.createSampleResult();
    }

    private prepareAudioData(base64Data: string, gcsUrl?: string): string {
        if (gcsUrl) {
            return AudioProcessorUtil.convertToGcsUri(gcsUrl);
        }

        const processedAudioBuffer = AudioProcessorUtil.preprocessAudio(
            Buffer.from(base64Data, 'base64'),
        );
        return processedAudioBuffer.toString('base64');
    }

    private createAudioConfig(mimeType: string) {
        const { encoding, sampleRate } = AudioProcessorUtil.getAudioConfig(mimeType);

        return {
            encoding,
            sampleRate,
            languageCode: 'ko-KR',
            enableSpeakerDiarization: true,
            diarizationSpeakerCount: 2,
            enableAutomaticPunctuation: true,
            maxAlternatives: 3, // 1 → 3 (더 많은 대안 고려)
            speechContexts: SpeechPatternsUtil.SPEECH_CONTEXTS,
        };
    }

    private adjustTimings(
        result: TranscriptionResult,
        sessionStartTimeOffset: number,
    ): TranscriptionResult {
        if (sessionStartTimeOffset > 0 && result.speakers) {
            result.speakers = result.speakers.map((speaker) => ({
                ...speaker,
                startTime: speaker.startTime + sessionStartTimeOffset,
                endTime: speaker.endTime + sessionStartTimeOffset,
            }));
        }
        return result;
    }
}
