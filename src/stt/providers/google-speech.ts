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
            // 동적으로 sampleRateHertz를 포함/제외하기 위한 구성
            const baseConfig: any = {
                // 기본 오디오 설정
                encoding: config.encoding as 'LINEAR16' | 'MP3' | 'WEBM_OPUS' | 'FLAC',
                languageCode: 'ko-KR', // 한국어 고정
                audioChannelCount: 1,

                // 2시간 연결을 위한 긴 오디오 모델
                model: 'latest_long',
                useEnhanced: true,

                // 화자 분리 설정 (한국어 대화용)
                enableSpeakerDiarization: config.enableSpeakerDiarization || false, // pynote 사용 시 false
                diarizationSpeakerCount: config.diarizationSpeakerCount || 0, // pynote 사용 시 0
                diarizationConfig: {
                    minSpeakerCount: 2,
                    maxSpeakerCount: 2,
                },

                // 한국어 인식 개선
                enableWordConfidence: true,
                enableWordTimeOffsets: true,
                enableAutomaticPunctuation: true,

                // 대화용 성능 최적화
                maxAlternatives: 1, // 안정적인 결과를 위해 1개로 제한
                profanityFilter: false,
                enableSeparateRecognitionPerChannel: false,

                // speech-patterms.ts의 사전 사용
                speechContexts: [
                    ...SpeechPatternsUtil.SPEECH_CONTEXTS,
                    ...(config.speechContexts || []),
                ],
            };

            // sampleRateHertz 처리 규칙:
            // - LINEAR16(WAV/RAW)인 경우만 설정 시도
            // - base64 콘텐츠가 있고 WAV 헤더에서 추출 가능한 경우 헤더 값을 사용
            // - 그 외(웹m/opus, mp3, flac, GCS URI)는 명시하지 않음 → 헤더/메타에서 자동 추론
            if (baseConfig.encoding === 'LINEAR16') {
                let detectedSampleRate: number | undefined;
                if (!gcsUrl && audioData) {
                    try {
                        const buf = Buffer.from(audioData, 'base64');
                        // 간단한 WAV 헤더 파싱: 24~27 바이트에 sampleRate (리틀엔디언)
                        if (
                            buf.length >= 28 &&
                            buf.slice(0, 4).toString('ascii') === 'RIFF' &&
                            buf.slice(8, 12).toString('ascii') === 'WAVE'
                        ) {
                            detectedSampleRate = buf.readUInt32LE(24);
                        }
                    } catch {
                        // 무시하고 config 값 사용/혹은 생략
                    }

                    if (detectedSampleRate && detectedSampleRate > 0) {
                        baseConfig.sampleRateHertz = detectedSampleRate;
                    } else if (config.sampleRate && config.sampleRate > 0) {
                        baseConfig.sampleRateHertz = config.sampleRate;
                    }
                }
                // gcsUrl인 경우는 sampleRateHertz를 명시하지 않음 (서버가 헤더에서 추론)
            }

            const request = {
                audio: gcsUrl ? { uri: this.convertToGcsUri(gcsUrl) } : { content: audioData },
                config: baseConfig,
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

            // speech-patterms.ts의 문장 연결성 개선 적용
            wordSegments = TextProcessorUtil.improveKoreanGrammar(wordSegments);

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

    private postProcessSegments(segments: SpeakerSegment[]): SpeakerSegment[] {
        if (segments.length === 0) return segments;

        // 1. 너무 짧은 세그먼트 병합
        const mergedSegments: SpeakerSegment[] = [];
        let currentSegment = { ...segments[0] };

        for (let i = 1; i < segments.length; i++) {
            const nextSegment = segments[i];
            const segmentDuration = currentSegment.endTime - currentSegment.startTime;

            // 같은 화자이고 세그먼트가 짧으면 병합
            if (currentSegment.speakerTag === nextSegment.speakerTag && segmentDuration < 1.0) {
                currentSegment.text_Content += ' ' + nextSegment.text_Content;
                currentSegment.endTime = nextSegment.endTime;
            } else {
                mergedSegments.push(currentSegment);
                currentSegment = { ...nextSegment };
            }
        }
        mergedSegments.push(currentSegment);

        // 2. 텍스트 정리
        return mergedSegments.map((segment) => ({
            ...segment,
            text_Content: segment.text_Content.trim(),
        }));
    }

    private processWordTimings(words: GoogleSpeechWord[]): SpeakerSegment[] {
        if (!words || words.length === 0) return [];

        // 🆕 개선된 화자 분리 로직
        const segments: SpeakerSegment[] = [];
        let currentSegment: SpeakerSegment | null = null;
        const minSegmentDuration = 0.5; // 최소 0.5초 세그먼트
        const maxSegmentDuration = 3.0; // 최대 10초 세그먼트

        // 🆕 추가: 문장 길이 기반 분할
        const maxTextLength = 30; // 최대 30자

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const cleanedText = TextProcessorUtil.cleanWordPieceTokens(word.word || '');

            if (!cleanedText.trim()) continue;

            const startTime = this.convertDurationToSeconds(word.startTime);
            const endTime = this.convertDurationToSeconds(word.endTime);
            const speakerTag = word.speakerTag ?? 0;

            // 화자 변경 감지
            const isSpeakerChange = currentSegment && currentSegment.speakerTag !== speakerTag;

            // 세그먼트가 너무 길어지면 강제 분할 (시간 기준)
            const isTooLong =
                currentSegment && startTime - currentSegment.startTime > maxSegmentDuration;

            // 🆕 세그먼트가 너무 길어지면 강제 분할 (텍스트 길이 기준)
            const isTextTooLong =
                currentSegment && currentSegment.text_Content.length > maxTextLength;

            if (isSpeakerChange || isTooLong || isTextTooLong) {
                if (currentSegment) {
                    if (currentSegment.endTime - currentSegment.startTime >= minSegmentDuration) {
                        segments.push(currentSegment);
                    }
                }
                // 새 세그먼트 시작
                currentSegment = {
                    text_Content: cleanedText,
                    startTime: Math.round(startTime * 10) / 10,
                    endTime: Math.round(endTime * 10) / 10,
                    speakerTag: speakerTag,
                };
            } else {
                if (currentSegment) {
                    // 기존 세그먼트에 텍스트 추가
                    currentSegment.text_Content += ' ' + cleanedText;
                    currentSegment.endTime = Math.round(endTime * 10) / 10;
                } else {
                    // 첫 번째 세그먼트
                    currentSegment = {
                        text_Content: cleanedText,
                        startTime: Math.round(startTime * 10) / 10,
                        endTime: Math.round(endTime * 10) / 10,
                        speakerTag: speakerTag,
                    };
                }
            }
        }

        // 마지막 세그먼트 처리
        if (
            currentSegment &&
            currentSegment.endTime - currentSegment.startTime >= minSegmentDuration
        ) {
            segments.push(currentSegment);
        }

        // 🆕 세그먼트 후처리
        return this.postProcessSegments(segments);
    }

    private createWordsFromTranscript(transcript: string): SpeakerSegment[] {
        if (!transcript.trim()) return [];

        const words = transcript.split(/\s+/).filter((word) => word.trim());
        const segmentDuration = 0.3; // 🆕 0.3초씩 할당

        this.logger.log(
            `Fallback: transcript에서 ${words.length}개 단어 생성, 각 ${segmentDuration}초씩`,
        );

        return words.map((word, index) => ({
            text_Content: word,
            startTime: Math.round(index * segmentDuration * 10) / 10,
            endTime: Math.round((index + 1) * segmentDuration * 10) / 10,
            speakerTag: 1,
        }));
    }

    private convertDurationToSeconds(duration: Duration | undefined): number {
        if (!duration) {
            this.logger.warn('Duration이 undefined입니다');
            return 0;
        }

        const seconds = typeof duration.seconds === 'number' ? duration.seconds : 0;
        const nanos = typeof duration.nanos === 'number' ? duration.nanos : 0;

        // �� 개선사항들
        // 1. 음수 시간 방지
        if (seconds < 0) {
            this.logger.warn(`음수 시간 감지: ${seconds}초`);
            return 0;
        }

        // 2. 너무 큰 시간 값 방지 (24시간 = 86400초)
        if (seconds > 86400) {
            this.logger.warn(`비정상적으로 큰 시간 값: ${seconds}초`);
            return 86400;
        }

        // 3. 나노초 범위 검증
        if (nanos < 0 || nanos >= 1000000000) {
            this.logger.warn(`비정상적인 나노초 값: ${nanos}`);
            return seconds; // 나노초 무시하고 초만 반환
        }

        const totalSeconds = seconds + nanos / 1000000000;

        // 4. 소수점 정밀도 제한 (소수점 1자리)
        return Math.round(totalSeconds * 10) / 10;
    }
}
