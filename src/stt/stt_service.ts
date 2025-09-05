// stt.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { SpeechClient } from '@google-cloud/speech';

// 실시간 녹음 처리를 위한 새로운 인터페이스
export interface STTResult {
    transcript: string;
    confidence: number;
    speakers?: Array<{
        text_Content: string; // DB 컬럼명과 일치 (snake_case)
        startTime: number;
        endTime: number;
        speakerTag: number;
    }>;
}

export interface StreamingSTTSession {
    sessionId: string;
    isRecording: boolean;
    chunks: STTResult[];
    startTime: number;
    currentChunkIndex: number;
}

interface Duration {
    seconds?: string | number;
    nanos?: string | number;
}

interface GoogleSpeechWordInfo {
    speaker: string;
    startTime?: Duration;
    endTime?: Duration;
    speakerTag?: number; // 화자 태그 추가
}

interface ConnectionTestResult {
    status: 'success' | 'error';
    message: string;
}

@Injectable()
export class STTService {
    private readonly logger = new Logger(STTService.name);
    private speechClient: SpeechClient | null = null;

    constructor() {
        try {
            if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
                this.logger.warn('Google Cloud 인증 정보가 설정되지 않았습니다. 샘플 모드 실행.');
                return;
            }
            this.speechClient = new SpeechClient();
            this.logger.log('Google Speech Client 초기화 완료');
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Speech Client 초기화 실패: ${msg}`);
            this.speechClient = null;
        }
    }

    async transcribeAudioBuffer(audioBuffer: Buffer, mimeType = 'audio/webm'): Promise<STTResult> {
        const base64Data = audioBuffer.toString('base64');
        return this.transcribeBase64Audio(base64Data, mimeType);
    }

    async testConnection(): Promise<ConnectionTestResult> {
        if (!this.speechClient)
            return { status: 'error', message: 'Speech Client가 초기화되지 않았습니다.' };
        try {
            const testRequest = {
                config: {
                    encoding: 'LINEAR16' as const,
                    sampleRateHertz: 16000,
                    languageCode: 'ko-KR',
                },
                audio: { content: Buffer.alloc(1024).toString('base64') },
            };
            await this.speechClient.recognize(testRequest);
            return { status: 'success', message: 'Google STT API 연결 성공' };
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            return { status: 'error', message: `연결 실패: ${msg}` };
        }
    }

    private processWordTimings(wordSegments?: GoogleSpeechWordInfo[]) {
        if (!wordSegments || !Array.isArray(wordSegments)) {
            return [];
        }

        // 더 강력한 필터링
        const filteredWordSegments = wordSegments
            .filter((wordSegment: { speaker: string }) => {
                const textContent = wordSegment.speaker || '';
                return (
                    textContent.trim() &&
                    textContent.length > 1 && // 2글자 이상만
                    !['아', '어', '음', '으'].includes(textContent) && // 감탄사 제거
                    textContent !== '▁' &&
                    textContent !== ' '
                );
            })
            .map((wordSegment) => ({
                text_Content: (wordSegment.speaker || '').replace(/^▁/, '').trim(),
                startTime: this.convertDurationToSeconds(wordSegment.startTime),
                endTime: this.convertDurationToSeconds(wordSegment.endTime),
                speakerTag: wordSegment.speakerTag || 0, // 실제 화자 태그 사용
            }))
            .filter((wordSegment) => wordSegment.text_Content.length > 0);

        return filteredWordSegments;
    }

    private createWordsFromTranscript(
        transcript: string,
    ): Array<{ text_Content: string; startTime: number; endTime: number; speakerTag: number }> {
        if (!transcript.trim()) {
            return [];
        }

        const textSegments = transcript
            .replace(/[.,!?;:]/g, ' ')
            .split(/\s+/)
            .filter((textSegment) => textSegment.trim().length > 0);

        return textSegments.map((textSegment, index) => ({
            text_Content: textSegment.trim(),
            startTime: index * 1,
            endTime: (index + 1) * 1,
            speakerTag: 0, // 기본값으로 화자 0 설정
        }));
    }

    async transcribeBase64Audio(base64Data: string, mimeType = 'audio/wav'): Promise<STTResult> {
        if (!this.speechClient) {
            return this.createSampleResult();
        }

        try {
            const { encoding, sampleRate } = this.getAudioConfig(mimeType);

            const request = {
                audio: { content: base64Data },
                config: {
                    encoding,
                    sampleRateHertz: sampleRate,
                    languageCode: 'ko-KR',
                    enableWordTimeOffsets: true,
                    enableAutomaticPunctuation: true,
                    model: 'latest_long',
                    useEnhanced: true,
                    enableSpeakerDiarization: true, // 화자 분리 활성화
                    diarizationSpeakerCount: 2, // 멘토, 멘티 2명
                    maxAlternatives: 1,
                    profanityFilter: false,
                    enableSeparateRecognitionPerChannel: false,
                },
            };

            // longRunningRecognize 사용
            const [operation] = await this.speechClient.longRunningRecognize(request);
            const [response] = await operation.promise();

            // 타입 안전한 응답 처리
            const results = response.results;
            if (!results || results.length === 0) {
                return { transcript: '', confidence: 0, speakers: [] };
            }

            const firstResult = results[0];
            if (!firstResult.alternatives || firstResult.alternatives.length === 0) {
                return { transcript: '', confidence: 0, speakers: [] };
            }

            const alternative = firstResult.alternatives[0];
            const transcript = alternative.transcript || '';
            const confidence = alternative.confidence || 0;

            let wordSegments = this.processWordTimings(
                (alternative.words as GoogleSpeechWordInfo[]) || undefined,
            );

            if (!wordSegments || wordSegments.length === 0) {
                wordSegments = this.createWordsFromTranscript(transcript);
            }

            return {
                transcript,
                confidence,
                speakers: wordSegments,
            };
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`STT 변환 실패: ${msg}`);
        }
    }

    private getAudioConfig(mimeType: string): {
        encoding: 'LINEAR16' | 'MP3' | 'WEBM_OPUS' | 'FLAC';
        sampleRate: number;
    } {
        if (mimeType.includes('mp3')) return { encoding: 'MP3', sampleRate: 44100 };
        if (mimeType.includes('webm')) return { encoding: 'WEBM_OPUS', sampleRate: 48000 };
        if (mimeType.includes('flac')) return { encoding: 'FLAC', sampleRate: 16000 };
        return { encoding: 'LINEAR16', sampleRate: 16000 };
    }

    private convertDurationToSeconds(duration?: Duration) {
        if (!duration) return 0;
        const seconds = parseInt(String(duration.seconds ?? '0'), 10);
        const nanos = parseInt(String(duration.nanos ?? '0'), 10);
        return seconds + nanos / 1_000_000_000;
    }

    createSampleResult(): STTResult {
        return {
            transcript: '안녕하세요. 구글 STT 테스트입니다.',
            confidence: 0.95,
            speakers: [
                { text_Content: '안녕하세요', startTime: 0.5, endTime: 1.2, speakerTag: 0 },
                { text_Content: '구글', startTime: 2.0, endTime: 2.3, speakerTag: 0 },
                { text_Content: 'STT', startTime: 2.4, endTime: 2.7, speakerTag: 1 },
                { text_Content: '테스트입니다', startTime: 2.8, endTime: 3.5, speakerTag: 1 },
            ],
        };
    }
}
