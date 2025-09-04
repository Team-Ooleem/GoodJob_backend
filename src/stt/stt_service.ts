import { Injectable, Logger } from '@nestjs/common';
import { SpeechClient } from '@google-cloud/speech';

export interface STTResult {
    transcript: string;
    confidence: number;
    words?: Array<{
        word: string;
        startTime: number;
        endTime: number;
    }>;
}

interface Duration {
    seconds?: string | number;
    nanos?: string | number;
}

interface GoogleSpeechWordInfo {
    word: string;
    startTime?: Duration;
    endTime?: Duration;
}

interface GoogleSpeechAlternative {
    transcript: string;
    confidence: number;
    words?: GoogleSpeechWordInfo[];
}

interface GoogleSpeechResult {
    alternatives?: GoogleSpeechAlternative[];
}

interface GoogleSpeechResponse {
    results?: GoogleSpeechResult[];
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
                this.logger.warn(
                    'Google Cloud 인증 정보가 설정되지 않았습니다. 샘플 모드로 실행됩니다.',
                );
                return;
            }

            this.logger.log('Google Speech Client 초기화 완료');
            this.speechClient = new SpeechClient();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error('Google Speech Client 초기화 실패:', errorMessage);
            this.speechClient = null;
        }
    }

    /**
     * Google STT API 연결을 테스트합니다
     * @returns 연결 테스트 결과 (status, message)
     */
    async testConnection(): Promise<ConnectionTestResult> {
        if (!this.speechClient) {
            return {
                status: 'error',
                message: 'Speech Client가 초기화되지 않았습니다.',
            };
        }

        try {
            this.logger.log('Google STT API 연결 테스트 시작...');

            const testRequest = {
                config: {
                    encoding: 'LINEAR16' as const,
                    sampleRateHertz: 16000,
                    languageCode: 'ko-KR',
                },
                audio: {
                    content: Buffer.alloc(1024).toString('base64'),
                },
            };

            await this.speechClient.recognize(testRequest);

            this.logger.log('Google STT API 연결 성공');
            return {
                status: 'success',
                message: 'Google STT API 연결 성공',
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error('Google STT API 연결 실패:', errorMessage);
            return {
                status: 'error',
                message: `연결 실패: ${errorMessage}`,
            };
        }
    }

    /**
     * Base64 인코딩된 오디오 데이터를 텍스트로 변환합니다
     * @param base64Data - Base64로 인코딩된 오디오 데이터
     * @param mimeType - 오디오 파일의 MIME 타입 (기본값: 'audio/wav')
     * @returns STT 변환 결과 (transcript, confidence, words)
     */
    async transcribeBase64Audio(base64Data: string, mimeType = 'audio/wav'): Promise<STTResult> {
        if (!this.speechClient) {
            this.logger.warn(
                'Google Speech Client가 초기화되지 않았습니다. 샘플 결과를 반환합니다.',
            );
            return this.createSampleResult();
        }

        try {
            this.logger.log('Base64 오디오 변환 시작...');

            const { encoding, sampleRate } = this.getAudioConfig(mimeType);

            const request = {
                audio: { content: base64Data },
                config: {
                    encoding,
                    sampleRateHertz: sampleRate,
                    languageCode: 'ko-KR',
                    enableWordTimeOffsets: true,
                    enableAutomaticPunctuation: true,
                    model: 'latest_short',
                    useEnhanced: true,
                },
            };

            this.logger.log(
                `STT 요청 설정: encoding=${encoding}, sampleRate=${sampleRate}, dataSize=${base64Data.length}`,
            );

            const response = (await this.speechClient.recognize(request)) as GoogleSpeechResponse;

            if (!response.results || response.results.length === 0) {
                this.logger.warn('STT 결과가 없습니다');
                return { transcript: '', confidence: 0, words: [] };
            }

            const result = response.results[0];
            const alternative = result.alternatives?.[0];

            if (!alternative) {
                return { transcript: '', confidence: 0, words: [] };
            }

            const words = this.processWordTimings(alternative.words);

            const sttResult: STTResult = {
                transcript: alternative.transcript || '',
                confidence: alternative.confidence || 0,
                words,
            };

            this.logger.log(
                `STT 변환 완료: "${sttResult.transcript}" (신뢰도: ${(sttResult.confidence * 100).toFixed(1)}%)`,
            );
            return sttResult;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error('STT 변환 실패:', errorMessage);
            throw new Error(`STT 변환 실패: ${errorMessage}`);
        }
    }

    /**
     * 오디오 버퍼를 텍스트로 변환합니다
     * @param audioBuffer - 오디오 파일의 버퍼 데이터
     * @param mimeType - 오디오 파일의 MIME 타입 (기본값: 'audio/webm')
     * @returns STT 변환 결과
     */
    async transcribeAudioBuffer(audioBuffer: Buffer, mimeType = 'audio/webm'): Promise<STTResult> {
        const base64Data = audioBuffer.toString('base64');
        return this.transcribeBase64Audio(base64Data, mimeType);
    }

    /**
     * MIME 타입에 따른 오디오 설정을 반환합니다
     * @param mimeType - 오디오 파일의 MIME 타입
     * @returns 인코딩 타입과 샘플 레이트
     */
    private getAudioConfig(mimeType: string): {
        encoding: 'LINEAR16' | 'MP3' | 'WEBM_OPUS' | 'FLAC';
        sampleRate: number;
    } {
        if (mimeType.includes('mp3')) {
            return { encoding: 'MP3', sampleRate: 44100 };
        }
        if (mimeType.includes('webm')) {
            return { encoding: 'WEBM_OPUS', sampleRate: 48000 };
        }
        if (mimeType.includes('flac')) {
            return { encoding: 'FLAC', sampleRate: 16000 };
        }
        return { encoding: 'LINEAR16', sampleRate: 16000 };
    }

    /**
     * Google STT 응답의 단어 타이밍 정보를 처리합니다
     * @param words - Google STT API에서 반환된 단어 정보 배열
     * @returns 처리된 단어 타이밍 정보 배열
     */
    private processWordTimings(words?: GoogleSpeechWordInfo[]): Array<{
        word: string;
        startTime: number;
        endTime: number;
    }> {
        if (!words) {
            return [];
        }

        return words.map((wordInfo) => ({
            word: wordInfo.word || '',
            startTime: this.convertDurationToSeconds(wordInfo.startTime),
            endTime: this.convertDurationToSeconds(wordInfo.endTime),
        }));
    }

    /**
     * Google Cloud Duration 객체를 초 단위로 변환합니다
     * @param duration - Google Cloud Duration 객체
     * @returns 초 단위 시간
     */
    private convertDurationToSeconds(duration?: Duration): number {
        if (!duration) return 0;

        const seconds = parseInt(String(duration.seconds ?? '0'), 10);
        const nanos = parseInt(String(duration.nanos ?? '0'), 10);

        return seconds + nanos / 1_000_000_000;
    }

    /**
     * 테스트용 샘플 STT 결과를 생성합니다
     * @returns 샘플 STT 결과
     */
    createSampleResult(): STTResult {
        return {
            transcript: '안녕하세요. 구글 STT 테스트입니다.',
            confidence: 0.95,
            words: [
                { word: '안녕하세요', startTime: 0.5, endTime: 1.2 },
                { word: '구글', startTime: 2.0, endTime: 2.3 },
                { word: 'STT', startTime: 2.4, endTime: 2.7 },
                { word: '테스트입니다', startTime: 2.8, endTime: 3.5 },
            ],
        };
    }
}
