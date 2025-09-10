import { Injectable, Logger } from '@nestjs/common';
import { GoogleSpeechProvider } from './providers/google-speech';
import { AudioProcessorUtil } from './utils/audio-processer';
import { SpeechPatternsUtil } from './utils/speech-patterms';
import { TextProcessorUtil } from './utils/text_processor';
import { TranscriptionResult, ConnectionTestResult, STTResult } from './entities/transcription';

@Injectable()
export class STTService {
    private readonly logger = new Logger(STTService.name);

    constructor(private readonly googleSpeechProvider: GoogleSpeechProvider) {}

    async transcribeAudioBuffer(
        audioBuffer: Buffer,
        mimeType = 'audio/webm',
        sessionStartTimeOffset = 0,
        gcsUrl?: string,
    ): Promise<STTResult> {
        const base64Data = audioBuffer.toString('base64');
        return this.transcribeBase64Audio(base64Data, mimeType, sessionStartTimeOffset, gcsUrl);
    }

    async transcribeBase64Audio(
        base64Data: string,
        mimeType = 'audio/wav',
        sessionStartTimeOffset = 0,
        gcsUrl?: string,
    ): Promise<STTResult> {
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

    // 원본 코드와 호환되는 normalizeTimings
    normalizeTimings(
        speakers: Array<{
            text_Content: string;
            startTime: number;
            endTime: number;
            speakerTag: number;
        }>,
        actualDuration: number,
    ): Array<{ text_Content: string; startTime: number; endTime: number; speakerTag: number }> {
        if (speakers.length === 0) return speakers;

        const maxSttTime = Math.max(...speakers.map((s) => s.endTime));
        const scaleFactor = actualDuration / maxSttTime;

        return speakers.map((speaker) => ({
            ...speaker,
            startTime: Math.round(speaker.startTime * scaleFactor * 10) / 10,
            endTime: Math.round(speaker.endTime * scaleFactor * 10) / 10,
        }));
    }

    async testConnection(): Promise<ConnectionTestResult> {
        return this.googleSpeechProvider.testConnection();
    }

    createSampleResult(): STTResult {
        return {
            transcript: '안녕하세요. 구글 STT 테스트입니다.',
            confidence: 0.95,
            speakers: [
                { text_Content: '안녕하세요', startTime: 0.5, endTime: 1.2, speakerTag: 1 },
                { text_Content: '구글', startTime: 2.0, endTime: 2.3, speakerTag: 1 },
                { text_Content: 'STT', startTime: 2.4, endTime: 2.7, speakerTag: 2 },
                { text_Content: '테스트입니다', startTime: 2.8, endTime: 3.5, speakerTag: 2 },
            ],
        };
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
            enableAutomaticPunctuation: false,
            maxAlternatives: 1,
            speechContexts: SpeechPatternsUtil.SPEECH_CONTEXTS,
        };
    }

    private adjustTimings(result: TranscriptionResult, sessionStartTimeOffset: number): STTResult {
        // TranscriptionResult를 STTResult로 변환
        let speakers =
            result.speakers?.map((speaker) => ({
                text_Content: speaker.text_Content,
                startTime: speaker.startTime + sessionStartTimeOffset,
                endTime: speaker.endTime + sessionStartTimeOffset,
                speakerTag: speaker.speakerTag,
            })) || [];

        // 엉뚱한 단어 교정 및 문장 개선 적용
        speakers = TextProcessorUtil.processAndCorrectText(speakers);

        // 문장 연결성 개선
        speakers = TextProcessorUtil.improveConversationFlow(speakers);

        const sttResult: STTResult = {
            transcript: result.transcript,
            confidence: result.confidence,
            speakers: speakers,
        };

        return sttResult;
    }
}
