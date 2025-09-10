import { Injectable, Logger } from '@nestjs/common';
import { SpeechClient } from '@google-cloud/speech';
import { SpeechProvider, AudioConfig, GoogleSpeechWord, Duration } from './speech-provider';
import { TranscriptionResult, ConnectionTestResult } from '../entities/transcription';
import { SpeakerSegment } from '../entities/speaker-segment';

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
            const msg = error instanceof Error ? error.message : String(error);
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
                    languageCode: config.languageCode,
                    audioChannelCount: 1,

                    // 다국어 지원 모델 (한국어 + 영어)
                    model: 'default',
                    useEnhanced: true,

                    // 화자 분리 설정 (다국어 지원)
                    enableSpeakerDiarization: config.enableSpeakerDiarization,
                    diarizationSpeakerCount: config.diarizationSpeakerCount,
                    diarizationConfig: {
                        minSpeakerCount: 1,
                        maxSpeakerCount: 2,
                    },

                    // 다국어 인식 개선
                    enableWordConfidence: true,
                    enableWordTimeOffsets: true,
                    enableAutomaticPunctuation: config.enableAutomaticPunctuation,

                    // 한국어 우선, 영어 보조
                    alternativeLanguageCodes: ['ko-KR', 'en-US'],

                    // 성능 최적화
                    maxAlternatives: 3,
                    profanityFilter: false,
                    enableSeparateRecognitionPerChannel: false,

                    // 다국어 인식 정확도 향상
                    speechContexts: config.speechContexts,
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
            const msg = error instanceof Error ? error.message : String(error);
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
            const msg = error instanceof Error ? error.message : String(error);
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

    private processWordTimings(
        wordSegments?: GoogleSpeechWord[],
        sessionStartTimeOffset = 0,
    ): SpeakerSegment[] {
        if (!wordSegments || !Array.isArray(wordSegments)) return [];

        const filteredWordSegments = wordSegments
            .filter((w) => {
                const text = w.word || ''; // null/undefined 처리
                const confidence = w.confidence || 0;

                // 기본 필터링
                if (!text.trim() || text.length === 0 || text === '▁' || text === ' ') {
                    return false;
                }

                // 신뢰도 임계값
                if (confidence < 0.1) {
                    return false;
                }
            })
            .map((w) => ({
                text_Content: (w.word || '').replace(/^▁/, '').trim(),
                startTime:
                    Math.round((Number(w.startTime?.seconds || 0) + sessionStartTimeOffset) * 10) /
                    10,
                endTime:
                    Math.round((Number(w.endTime?.seconds || 0) + sessionStartTimeOffset) * 10) /
                    10,
                speakerTag: w.speakerTag || 1,
            }))
            .filter((w) => w.text_Content.length > 0);

        const sentences = this.groupWordsIntoSentences(filteredWordSegments);
        const mergedSentences = this.mergeSimilarSpeakers(sentences);
        return this.enhanceContinuity(mergedSentences);
    }
    private mergeSimilarSpeakers(sentences: SpeakerSegment[]): SpeakerSegment[] {
        if (sentences.length === 0) return [];

        const merged: SpeakerSegment[] = [];
        let currentSpeaker = sentences[0].speakerTag;
        let currentText = sentences[0].text_Content;
        let startTime = sentences[0].startTime;
        let endTime = sentences[0].endTime;

        for (let i = 1; i < sentences.length; i++) {
            const sentence = sentences[i];

            // 짧은 문장이고 시간 간격이 가까우면 같은 화자로 처리
            const timeGap = sentence.startTime - endTime;
            const isShortSentence = sentence.text_Content.length < 5;
            const isCloseInTime = timeGap < 1.0; // 1초 이내

            if (isShortSentence && isCloseInTime && sentence.speakerTag !== currentSpeaker) {
                // 화자 변경 무시하고 통합
                currentText += ' ' + sentence.text_Content;
                endTime = sentence.endTime;
            } else {
                // 새로운 문장으로 처리
                merged.push({
                    text_Content: currentText.trim(),
                    startTime: Math.round(startTime * 10) / 10,
                    endTime: Math.round(endTime * 10) / 10,
                    speakerTag: currentSpeaker,
                });
                currentText = sentence.text_Content;
                currentSpeaker = sentence.speakerTag;
                startTime = sentence.startTime;
                endTime = sentence.endTime;
            }
        }

        // 마지막 문장 추가
        merged.push({
            text_Content: currentText.trim(),
            startTime: Math.round(startTime * 10) / 10,
            endTime: Math.round(endTime * 10) / 10,
            speakerTag: currentSpeaker,
        });

        return merged;
    }

    private enhanceContinuity(sentences: SpeakerSegment[]): SpeakerSegment[] {
        return sentences.map((sentence, index) => {
            // 이전 문장과의 연속성 체크
            if (index > 0) {
                const prevSentence = sentences[index - 1];
                const timeGap = sentence.startTime - prevSentence.endTime;

                // 시간 간격이 너무 작으면 연결
                if (timeGap < 0.5) {
                    return {
                        ...sentence,
                        startTime: Math.round(prevSentence.endTime * 10) / 10, // 시간 연결
                    };
                }
            }

            return sentence;
        });
    }

    private groupWordsIntoSentences(wordSegments: SpeakerSegment[]): SpeakerSegment[] {
        if (wordSegments.length === 0) return [];

        const sentences: SpeakerSegment[] = [];

        let currentSentence = '';
        let currentSpeaker = wordSegments[0].speakerTag;
        let sentenceStartTime = wordSegments[0].startTime;
        let sentenceEndTime = wordSegments[0].endTime;
        let wordCount = 0;

        // 더 정확한 설정
        const PAUSE_THRESHOLD = 1.5; // 더 정확한 자르기
        const MIN_WORDS_PER_SENTENCE = 1;
        const MAX_WORDS_PER_SENTENCE = 30; // 더 짧은 문장

        for (let i = 0; i < wordSegments.length; i++) {
            const word = wordSegments[i];

            // 시간 간격 계산 개선
            const prevEndTime = i > 0 ? wordSegments[i - 1].endTime : word.startTime;
            const timeGap = word.startTime - prevEndTime;

            // 화자 변경시 즉시 분리
            const isSpeakerChange = word.speakerTag !== currentSpeaker;

            // 시간 간격 체크 (같은 화자일 때만)
            const isLongPause =
                !isSpeakerChange &&
                i > 0 &&
                timeGap > PAUSE_THRESHOLD &&
                wordCount >= MIN_WORDS_PER_SENTENCE;

            const isNewSentence =
                isSpeakerChange || isLongPause || wordCount >= MAX_WORDS_PER_SENTENCE;

            if (isNewSentence) {
                // 현재 문장 저장
                if (currentSentence.trim().length > 0) {
                    sentences.push({
                        text_Content: this.cleanKoreanText(currentSentence.trim()),
                        startTime: Math.round(sentenceStartTime * 10) / 10,
                        endTime: Math.round(sentenceEndTime * 10) / 10,
                        speakerTag: currentSpeaker,
                    });
                }

                // 새로운 문장 시작
                currentSentence = word.text_Content;
                currentSpeaker = word.speakerTag;
                sentenceStartTime = word.startTime;
                sentenceEndTime = word.endTime;
                wordCount = 1;
            } else {
                // 문장 계속 이어가기
                currentSentence += ' ' + word.text_Content;
                sentenceEndTime = word.endTime; // 끝 시간만 업데이트
                wordCount += 1;
            }
        }

        // 마지막 문장 저장
        if (currentSentence.trim().length > 0) {
            sentences.push({
                text_Content: currentSentence.trim(),
                startTime: Math.round(sentenceStartTime * 10) / 10,
                endTime: Math.round(sentenceEndTime * 10) / 10,
                speakerTag: currentSpeaker,
            });
        }

        return sentences;
    }

    private createWordsFromTranscript(
        transcript: string,
        sessionStartTimeOffset = 0,
    ): SpeakerSegment[] {
        if (!transcript.trim()) return [];
        const textSegments = transcript
            .replace(/[.,!?;:]/g, ' ')
            .split(/\s+/)
            .filter((t) => t.trim().length > 0);
        const wordDuration = 1; // fallback 1초 단위
        return textSegments.map((text, idx) => ({
            text_Content: text.trim(),
            startTime: Math.round((sessionStartTimeOffset + idx * wordDuration) * 10) / 10,
            endTime: Math.round((sessionStartTimeOffset + (idx + 1) * wordDuration) * 10) / 10,
            speakerTag: 1,
        }));
    }

    private cleanKoreanText(text: string): string {
        if (!text || typeof text !== 'string') return '';

        return text.replace(/\s+/g, ' ').trim();
    }

    private convertDurationToSeconds(duration?: Duration) {
        if (!duration) return 0;
        const seconds = parseInt(String(duration.seconds ?? '0'), 10);
        const nanos = parseInt(String(duration.nanos ?? '0'), 10);
        return seconds + nanos / 1_000_000_000;
    }
}
