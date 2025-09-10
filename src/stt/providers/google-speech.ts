import { Injectable, Logger } from '@nestjs/common';
import { SpeechClient } from '@google-cloud/speech';
import { SpeechProvider, AudioConfig, GoogleSpeechWord, Duration } from './speech-provider';
import { TranscriptionResult, ConnectionTestResult } from '../entities/transcription';
import { SpeakerSegment } from '../entities/speaker-segment';
import { SpeechPatternsUtil } from '../utils/speech-patterms';
import { TextProcessorUtil } from '../utils/text_processor';

@Injectable()
export class GoogleSpeechProvider implements SpeechProvider {
    private readonly logger = new Logger(GoogleSpeechProvider.name);
    private speechClient: SpeechClient | null = null;

    constructor() {
        this.initializeClient();
    }

    private initializeClient(): void {
        try {
            if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
                this.logger.warn('Google Cloud 인증 정보가 설정되지 않았습니다. 샘플 모드 실행.');
                return;
            }
            this.speechClient = new SpeechClient();
            this.logger.log('Google Speech Client 초기화 완료');
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다';
            this.logger.error(`Speech Client 초기화 실패: ${msg}`);
            this.speechClient = null;
        }
    }

    async transcribe(
        audioData: string,
        config: AudioConfig,
        gcsUrl?: string,
    ): Promise<TranscriptionResult> {
        if (!this.speechClient) return this.createSampleResult();

        try {
            const request = {
                audio: gcsUrl ? { uri: this.convertToGcsUri(gcsUrl) } : { content: audioData },
                config: {
                    // 기본 오디오 설정
                    encoding: config.encoding as 'LINEAR16' | 'MP3' | 'WEBM_OPUS' | 'FLAC',
                    sampleRateHertz: config.sampleRate,
                    languageCode: 'ko-KR', // 한국어 고정
                    audioChannelCount: 1,

                    // 2시간 연결을 위한 긴 오디오 모델
                    model: 'latest_long',
                    useEnhanced: true,

                    // 화자 분리 설정 (한국어 대화용)
                    enableSpeakerDiarization: config.enableSpeakerDiarization,
                    diarizationSpeakerCount: config.diarizationSpeakerCount,
                    diarizationConfig: {
                        minSpeakerCount: 1,
                        maxSpeakerCount: 2,
                    },

                    // 한국어 인식 개선
                    enableWordConfidence: true,
                    enableWordTimeOffsets: true,
                    enableAutomaticPunctuation: false, // 자동 구두점 끄기 - 자연스러운 문장을 위해

                    // 한국어 우선, 영어 보조
                    alternativeLanguageCodes: ['en-US'],

                    // 대화용 성능 최적화
                    maxAlternatives: 1, // 안정적인 결과를 위해 1개로 제한
                    profanityFilter: false,
                    enableSeparateRecognitionPerChannel: false,

                    // speech-patterms.ts의 사전 사용
                    speechContexts: [
                        ...SpeechPatternsUtil.SPEECH_CONTEXTS,
                        ...(config.speechContexts || []),
                    ],
                },
            };

            const operation = await this.speechClient.longRunningRecognize(request);

            // 배열인지 확인하고 첫 번째 요소 사용
            const [operationResult] = operation;
            const [response] = await operationResult.promise();
            const results = response.results;

            if (!results || results.length === 0)
                return { transcript: '', confidence: 0, speakers: [] };

            // 모든 결과 처리하도록 수정
            const allResults = results.flatMap((result) => result.alternatives || []);
            const bestResult = allResults.reduce(
                (best, current) =>
                    (current.confidence || 0) > (best.confidence || 0) ? current : best,
                allResults[0],
            );

            // 모든 결과를 합치기
            const combinedTranscript = results
                .map((result) => result.alternatives?.[0]?.transcript || '')
                .filter((t) => t.trim())
                .join(' ');

            const transcript = combinedTranscript || bestResult.transcript || '';
            const confidence = bestResult.confidence || 0;

            // 모든 결과의 words 합치기
            const allWords = results.flatMap((result) => result.alternatives?.[0]?.words || []);

            let wordSegments = this.processWordTimings(allWords as GoogleSpeechWord[]);
            if (!wordSegments || wordSegments.length === 0) {
                wordSegments = this.createWordsFromTranscript(transcript);
            }

            // text_processor.ts의 교정 로직 적용
            wordSegments = TextProcessorUtil.processAndCorrectText(wordSegments);

            // speech-patterms.ts의 문장 연결성 개선 적용
            wordSegments = SpeechPatternsUtil.improveSentenceFlow(wordSegments);

            // 결과 품질 검증 및 로깅
            this.logger.log(
                `STT 결과 - 신뢰도: ${confidence.toFixed(3)}, 텍스트 길이: ${transcript.length}, 세그먼트 수: ${wordSegments.length}`,
            );

            // 너무 낮은 신뢰도나 의미없는 결과 경고
            if (confidence < 0.5) {
                this.logger.warn(`STT 신뢰도가 낮습니다: ${confidence.toFixed(3)}`);
            }

            if (transcript.length < 5) {
                this.logger.warn(`STT 결과가 너무 짧습니다: "${transcript}"`);
            }

            return { transcript, confidence, speakers: wordSegments };
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다';
            this.logger.error(`STT 변환 실패: ${msg}`);
            throw new Error(`STT 변환 실패: ${msg}`);
        }
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
            const msg = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다';
            return { status: 'error', message: `연결 실패: ${msg}` };
        }
    }

    createSampleResult(): TranscriptionResult {
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

    private convertToGcsUri(gcsUrl: string): string {
        // GCS URL을 gs:// 형식으로 변환
        if (gcsUrl.startsWith('gs://')) return gcsUrl;
        if (gcsUrl.includes('storage.googleapis.com')) {
            const match = gcsUrl.match(/storage\.googleapis\.com\/([^/]+)\/(.+)/);
            if (match) return `gs://${match[1]}/${match[2]}`;
        }
        return gcsUrl; // fallback
    }

    private processWordTimings(words: GoogleSpeechWord[]): SpeakerSegment[] {
        if (!words || words.length === 0) return [];

        return words.map((word) => ({
            text_Content: word.word || '',
            startTime: this.convertDurationToSeconds(word.startTime),
            endTime: this.convertDurationToSeconds(word.endTime),
            speakerTag: word.speakerTag || 1,
        }));
    }

    private createWordsFromTranscript(transcript: string): SpeakerSegment[] {
        if (!transcript.trim()) return [];

        const words = transcript.split(/\s+/).filter((word) => word.trim());
        const segmentDuration = 1.0; // 기본 1초씩 할당

        return words.map((word, index) => ({
            text_Content: word,
            startTime: index * segmentDuration,
            endTime: (index + 1) * segmentDuration,
            speakerTag: 1,
        }));
    }

    private convertDurationToSeconds(duration: Duration | undefined): number {
        if (!duration) return 0;
        const seconds = typeof duration.seconds === 'number' ? duration.seconds : 0;
        const nanos = typeof duration.nanos === 'number' ? duration.nanos : 0;
        return seconds + nanos / 1000000000;
    }
}
