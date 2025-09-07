/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { SpeechClient } from '@google-cloud/speech';

export interface STTResult {
    transcript: string;
    confidence: number;
    speakers?: Array<{
        text_Content: string;
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
    word: string;
    startTime?: Duration;
    endTime?: Duration;
    speakerTag?: number;
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

    // 타이밍 정규화
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
            startTime: speaker.startTime * scaleFactor,
            endTime: speaker.endTime * scaleFactor,
        }));
    }

    private processWordTimings(wordSegments?: GoogleSpeechWordInfo[], sessionStartTimeOffset = 0) {
        if (!wordSegments || !Array.isArray(wordSegments)) return [];

        const filteredWordSegments = wordSegments
            .filter((w) => {
                const text = w.word || '';
                return (
                    text.trim() &&
                    text.length > 1 &&
                    !['아', '어', '음', '으'].includes(text) &&
                    text !== '▁' &&
                    text !== ' '
                );
            })
            .map((w) => ({
                text_Content: (w.word || '').replace(/^▁/, '').trim(),
                startTime: this.convertDurationToSeconds(w.startTime) + sessionStartTimeOffset,
                endTime: this.convertDurationToSeconds(w.endTime) + sessionStartTimeOffset,
                speakerTag: w.speakerTag || 1,
            }))
            .filter((w) => w.text_Content.length > 0);

        return this.groupWordsIntoSentences(filteredWordSegments);
    }

    private groupWordsIntoSentences(
        wordSegments: Array<{
            text_Content: string;
            startTime: number;
            endTime: number;
            speakerTag: number;
        }>,
    ): Array<{ text_Content: string; startTime: number; endTime: number; speakerTag: number }> {
        if (wordSegments.length === 0) return [];

        const sentences: Array<{
            text_Content: string;
            startTime: number;
            endTime: number;
            speakerTag: number;
        }> = [];
        let currentSentence = '';
        let currentSpeaker = wordSegments[0].speakerTag;
        let sentenceStartTime = wordSegments[0].startTime;
        let sentenceEndTime = wordSegments[0].endTime;
        let wordCount = 0;

        const PAUSE_THRESHOLD = 1.2; // 초 단위
        const MIN_WORDS_PER_SENTENCE = 3;

        for (let i = 0; i < wordSegments.length; i++) {
            const word = wordSegments[i];
            const prevEndTime = i > 0 ? wordSegments[i - 1].endTime : word.startTime;

            const isNewSentence =
                word.speakerTag !== currentSpeaker ||
                (i > 0 &&
                    word.startTime - prevEndTime > PAUSE_THRESHOLD &&
                    wordCount >= MIN_WORDS_PER_SENTENCE);

            if (isNewSentence) {
                if (currentSentence.trim().length > 0) {
                    sentences.push({
                        text_Content: currentSentence.trim(),
                        startTime: sentenceStartTime,
                        endTime: sentenceEndTime,
                        speakerTag: currentSpeaker,
                    });
                }
                currentSentence = word.text_Content;
                currentSpeaker = word.speakerTag;
                sentenceStartTime = word.startTime;
                sentenceEndTime = word.endTime;
                wordCount = 1;
            } else {
                currentSentence += ' ' + word.text_Content;
                sentenceEndTime = word.endTime;
                wordCount += 1;
            }
        }

        if (currentSentence.trim().length > 0) {
            sentences.push({
                text_Content: currentSentence.trim(),
                startTime: sentenceStartTime,
                endTime: sentenceEndTime,
                speakerTag: currentSpeaker,
            });
        }

        return sentences;
    }

    private createWordsFromTranscript(
        transcript: string,
        sessionStartTimeOffset = 0,
    ): Array<{ text_Content: string; startTime: number; endTime: number; speakerTag: number }> {
        if (!transcript.trim()) return [];
        const textSegments = transcript
            .replace(/[.,!?;:]/g, ' ')
            .split(/\s+/)
            .filter((t) => t.trim().length > 0);
        const wordDuration = 1; // fallback 1초 단위
        return textSegments.map((text, idx) => ({
            text_Content: text.trim(),
            startTime: sessionStartTimeOffset + idx * wordDuration,
            endTime: sessionStartTimeOffset + (idx + 1) * wordDuration,
            speakerTag: 1,
        }));
    }

    private getAudioConfig(mimeType: string) {
        if (mimeType.includes('mp3')) return { encoding: 'MP3', sampleRate: 44100 };
        if (mimeType.includes('webm')) return { encoding: 'WEBM_OPUS', sampleRate: 48000 };
        if (mimeType.includes('flac')) return { encoding: 'FLAC', sampleRate: 16000 };
        return { encoding: 'LINEAR16', sampleRate: 16000 };
    }

    async transcribeBase64Audio(
        base64Data: string,
        mimeType = 'audio/wav',
        sessionStartTimeOffset = 0,
    ): Promise<STTResult> {
        if (!this.speechClient) return this.createSampleResult();

        try {
            const { encoding, sampleRate } = this.getAudioConfig(mimeType);
            const request = {
                audio: { content: base64Data },
                config: {
                    // 기본 오디오 설정
                    encoding: encoding as 'LINEAR16' | 'MP3' | 'WEBM_OPUS' | 'FLAC',
                    sampleRateHertz: sampleRate,
                    languageCode: 'ko-KR',
                    audioChannelCount: 1, // ✅ 모노 채널 (화자 분리에 최적)

                    // STT 2.0 핵심 설정
                    model: 'latest_long', // ✅ 최신 모델
                    useEnhanced: true, // ✅ 향상된 기능

                    // 화자 분리 설정
                    enableSpeakerDiarization: true, // ✅ 화자 분리 활성화
                    diarizationSpeakerCount: 2, // ✅ 2명 화자

                    // STT 2.0 추가 기능
                    enableWordConfidence: true, // ✅ 단어별 신뢰도
                    enableWordTimeOffsets: true, // ✅ 단어별 시간 정보
                    enableAutomaticPunctuation: true, // ✅ 자동 구두점

                    // 성능 최적화
                    maxAlternatives: 1, // ✅ 최대 대안 수
                    profanityFilter: false, // ✅ 욕설 필터 비활성화
                    enableSeparateRecognitionPerChannel: false, // ✅ 모노 채널 사용

                    // 한국어 특화
                    alternativeLanguageCodes: ['ko-KR'], // ✅ 한국어 우선 처리
                },
            };

            const operation = await this.speechClient.longRunningRecognize(request);

            // 배열인지 확인하고 첫 번째 요소 사용
            const [operationResult] = operation;
            const [response] = await operationResult.promise();
            const results = response.results as any[];

            if (!results || results.length === 0)
                return { transcript: '', confidence: 0, speakers: [] };

            const alternative = results[0].alternatives?.[0];
            if (!alternative) return { transcript: '', confidence: 0, speakers: [] };

            const transcript = alternative.transcript || '';

            const confidence = alternative.confidence || 0;

            let wordSegments = this.processWordTimings(
                alternative.words as GoogleSpeechWordInfo[],
                sessionStartTimeOffset,
            );
            if (!wordSegments || wordSegments.length === 0) {
                wordSegments = this.createWordsFromTranscript(transcript, sessionStartTimeOffset);
            }

            return { transcript, confidence, speakers: wordSegments };
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`STT 변환 실패: ${msg}`);
            throw new Error(`STT 변환 실패: ${msg}`);
        }
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
                { text_Content: '안녕하세요', startTime: 0.5, endTime: 1.2, speakerTag: 1 },
                { text_Content: '구글', startTime: 2.0, endTime: 2.3, speakerTag: 1 },
                { text_Content: 'STT', startTime: 2.4, endTime: 2.7, speakerTag: 2 },
                { text_Content: '테스트입니다', startTime: 2.8, endTime: 3.5, speakerTag: 2 },
            ],
        };
    }
}
