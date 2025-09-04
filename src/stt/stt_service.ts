// stt.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { SpeechClient } from '@google-cloud/speech';

export interface STTResult {
    transcript: string;
    confidence: number;
    words?: Array<{ word: string; startTime: number; endTime: number }>;
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

    private processWordTimings(words?: GoogleSpeechWordInfo[]) {
        if (!words || !Array.isArray(words)) {
            return [];
        }

        return words.map((w) => ({
            word: w.word || '',
            startTime: this.convertDurationToSeconds(w.startTime),
            endTime: this.convertDurationToSeconds(w.endTime),
        }));
    }

    // transcript를 기반으로 단어 배열 생성하는 새로운 메서드
    private createWordsFromTranscript(
        transcript: string,
    ): Array<{ word: string; startTime: number; endTime: number }> {
        if (!transcript.trim()) {
            return [];
        }

        // 한국어 단어 분할 (공백, 구두점 기준)
        const words = transcript
            .replace(/[.,!?;:]/g, ' ') // 구두점을 공백으로 변경
            .split(/\s+/)
            .filter((word) => word.trim().length > 0);

        // 각 단어에 대략적인 시간 할당 (단어당 0.5초 가정)
        return words.map((word, index) => ({
            word: word.trim(),
            startTime: index * 0.5,
            endTime: (index + 1) * 0.5,
        }));
    }

    async transcribeBase64Audio(base64Data: string, mimeType = 'audio/wav'): Promise<STTResult> {
        if (!this.speechClient) {
            console.log('⚠️ Speech Client 없음, 샘플 반환');
            return this.createSampleResult();
        }

        try {
            console.log('🎯 STT 변환 시작:');
            console.log('- MIME타입:', mimeType);
            console.log('- Base64 길이:', base64Data.length);

            const { encoding, sampleRate } = this.getAudioConfig(mimeType);

            console.log('🎵 사용할 설정:');
            console.log('- encoding:', encoding);
            console.log('- sampleRate:', sampleRate);

            const request = {
                audio: { content: base64Data },
                config: {
                    encoding,
                    sampleRateHertz: sampleRate,
                    languageCode: 'ko-KR',
                    enableWordTimeOffsets: true,
                    enableAutomaticPunctuation: true,
                    model: 'latest_long', // 긴 오디오 처리에 적합
                    useEnhanced: true,
                    enableSpeakerDiarization: false,
                    diarizationSpeakerCount: 0,
                    // WebM 최적화를 위한 추가 설정
                    maxAlternatives: 1,
                    profanityFilter: false,
                    enableSeparateRecognitionPerChannel: false,
                },
            };

            console.log('📡 Google STT API 호출 시작...');
            console.log('🔧 요청 설정:', JSON.stringify(request.config, null, 2));

            const rawResponse = await this.speechClient.recognize(request);

            // Google Speech API는 배열 형태로 응답을 반환할 수 있음
            const response = Array.isArray(rawResponse)
                ? rawResponse[0]
                : (rawResponse as GoogleSpeechResponse);

            console.log('📥 Google STT 응답:');
            console.log('- 원본 응답 타입:', Array.isArray(rawResponse) ? 'array' : 'object');
            console.log('- results 존재:', !!response.results);
            console.log('- results 개수:', response.results?.length || 0);

            if (response.results && response.results.length > 0) {
                console.log(
                    '- 첫 번째 result alternatives 개수:',
                    response.results[0].alternatives?.length || 0,
                );
            }

            // 상세 응답 로그 (디버깅용)
            console.log('🔍 전체 응답:', JSON.stringify(response, null, 2));

            const alternative = response.results?.[0]?.alternatives?.[0];

            if (!alternative) {
                console.log('⚠️ alternative 없음 - 음성 인식 실패');
                console.log('- 가능한 원인: 무음, 인식 불가능한 음성, 형식 문제');
                return { transcript: '', confidence: 0, words: [] };
            }

            const transcript = alternative.transcript || '';
            const confidence = alternative.confidence || 0;

            console.log('✅ STT 변환 성공:');
            console.log('- transcript:', transcript);
            console.log('- confidence:', confidence);
            console.log('- words 존재:', !!alternative.words);
            console.log('- words 개수:', alternative.words?.length || 0);

            // 워드 정보 처리 - API에서 제공되지 않으면 transcript 기반으로 생성
            let words = this.processWordTimings(
                alternative.words as GoogleSpeechWordInfo[] | undefined,
            );

            // 워드 정보가 없거나 비어있으면 transcript를 기반으로 단어 분할
            if (!words || words.length === 0) {
                console.log('🔧 단어 타이밍 정보 없음, transcript 기반으로 생성');
                words = this.createWordsFromTranscript(transcript);
            }

            console.log('📊 최종 결과:');
            console.log('- 단어 개수:', words.length);

            return {
                transcript,
                confidence,
                words,
            };
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);

            // 특정 에러에 대한 추가 정보
            if (msg.includes('invalid argument')) {
                console.error('💡 해결 방법: 오디오 형식이나 인코딩 설정 확인 필요');
            }
            if (msg.includes('permission')) {
                console.error('💡 해결 방법: Google Cloud 권한 설정 확인 필요');
            }

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
            words: [
                { word: '안녕하세요', startTime: 0.5, endTime: 1.2 },
                { word: '구글', startTime: 2.0, endTime: 2.3 },
                { word: 'STT', startTime: 2.4, endTime: 2.7 },
                { word: '테스트입니다', startTime: 2.8, endTime: 3.5 },
            ],
        };
    }
}
