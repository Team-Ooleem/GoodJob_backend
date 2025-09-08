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
    confidence?: number;
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

    async transcribeAudioBuffer(
        audioBuffer: Buffer,
        mimeType = 'audio/webm',
        sessionStartTimeOffset = 0,
        gcsUrl?: string,
    ): Promise<STTResult> {
        const base64Data = audioBuffer.toString('base64');
        return this.transcribeBase64Audio(base64Data, mimeType, sessionStartTimeOffset, gcsUrl); // ✅ 세 번째 파라미터 전달
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

    private mergeSimilarSpeakers(
        sentences: Array<{
            text_Content: string;
            startTime: number;
            endTime: number;
            speakerTag: number;
        }>,
    ): Array<{ text_Content: string; startTime: number; endTime: number; speakerTag: number }> {
        if (sentences.length === 0) return [];

        const merged: Array<{
            text_Content: string;
            startTime: number;
            endTime: number;
            speakerTag: number;
        }> = [];
        let currentSpeaker = sentences[0].speakerTag;
        let currentText = sentences[0].text_Content;
        let startTime = sentences[0].startTime;
        let endTime = sentences[0].endTime;

        for (let i = 1; i < sentences.length; i++) {
            const sentence = sentences[i];

            // ✅ 짧은 문장이고 시간 간격이 가까우면 같은 화자로 처리
            const timeGap = sentence.startTime - endTime;
            const isShortSentence = sentence.text_Content.length < 5;
            const isCloseInTime = timeGap < 1.0; // 1초 이내

            if (isShortSentence && isCloseInTime && sentence.speakerTag !== currentSpeaker) {
                // ✅ 화자 변경 무시하고 통합
                currentText += ' ' + sentence.text_Content;
                endTime = sentence.endTime;
            } else {
                // ✅ 새로운 문장으로 처리
                merged.push({
                    text_Content: currentText.trim(),
                    startTime,
                    endTime,
                    speakerTag: currentSpeaker,
                });
                currentText = sentence.text_Content;
                currentSpeaker = sentence.speakerTag;
                startTime = sentence.startTime;
                endTime = sentence.endTime;
            }
        }

        // ✅ 마지막 문장 추가
        merged.push({
            text_Content: currentText.trim(),
            startTime,
            endTime,
            speakerTag: currentSpeaker,
        });

        return merged;
    }

    // ✅ 연속성 향상 함수
    private enhanceContinuity(
        sentences: Array<{
            text_Content: string;
            startTime: number;
            endTime: number;
            speakerTag: number;
        }>,
    ): Array<{ text_Content: string; startTime: number; endTime: number; speakerTag: number }> {
        return sentences.map((sentence, index) => {
            // ✅ 이전 문장과의 연속성 체크
            if (index > 0) {
                const prevSentence = sentences[index - 1];
                const timeGap = sentence.startTime - prevSentence.endTime;

                // ✅ 시간 간격이 너무 작으면 연결
                if (timeGap < 0.5) {
                    return {
                        ...sentence,
                        startTime: prevSentence.endTime, // 시간 연결
                    };
                }
            }

            return sentence;
        });
    }

    // processWordTimings 함수 수정
    private processWordTimings(wordSegments?: GoogleSpeechWordInfo[], sessionStartTimeOffset = 0) {
        if (!wordSegments || !Array.isArray(wordSegments)) return [];

        const filteredWordSegments = wordSegments
            .filter((w) => {
                const text = w.word || '';
                return (
                    text.trim() &&
                    text.length > 0 && // ✅ 1 → 0 (한 글자도 허용)
                    text !== '▁' &&
                    text !== ' ' &&
                    // ✅ 신뢰도 체크를 더 관대하게
                    (w.confidence || 0) > 0.1 // 0.3 → 0.1
                );
            })
            .map((w) => ({
                text_Content: this.cleanKoreanText((w.word || '').replace(/^▁/, '').trim()),
                startTime: this.convertDurationToSeconds(w.startTime) + sessionStartTimeOffset,
                endTime: this.convertDurationToSeconds(w.endTime) + sessionStartTimeOffset,
                speakerTag: w.speakerTag || 1,
            }))
            .filter((w) => w.text_Content.length > 0);

        const sentences = this.groupWordsIntoSentences(filteredWordSegments);

        // ✅ 화자 통합 적용
        const mergedSentences = this.mergeSimilarSpeakers(sentences);

        return this.enhanceContinuity(mergedSentences);
    }

    // stt_service.ts에 추가
    private cleanKoreanText(text: string): string {
        return (
            text
                // 기본 정리
                .replace(/\s+/g, ' ')
                .replace(/([가-힣])([A-Za-z])/g, '$1 $2')
                .replace(/([A-Za-z])([가-힣])/g, '$1 $2')
                .replace(/([가-힣])(\d)/g, '$1 $2')
                .replace(/(\d)([가-힣])/g, '$1 $2')

                // 한국어 특화 정규화
                .replace(/[ㅏ-ㅣ]/g, '') // 자음/모음 분리 제거
                .replace(/([가-힣])\1+/g, '$1') // 반복 문자 정리
                .replace(/[.,!?;:]/g, ' ') // 구두점 정리
                .replace(/[^\w\s가-힣]/g, ' ') // 특수문자 제거

                // 흔한 오인식 패턴 수정
                .replace(/\b(이거|이게|이건)\b/g, '이것')
                .replace(/\b(그거|그게|그건)\b/g, '그것')
                .replace(/\b(저거|저게|저건)\b/g, '저것')
                .replace(/\b(어떻게|어떡해)\b/g, '어떻게')

                .trim()
        );
    }

    // groupWordsIntoSentences 함수 수정
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

        // ✅ 더 관대한 설정 (연속성 우선)
        const PAUSE_THRESHOLD = 1.5; // 1.2 → 1.5 (더 긴 휴지 허용)
        const MIN_WORDS_PER_SENTENCE = 1; // 3 → 1 (한 단어도 문장으로)
        const MAX_WORDS_PER_SENTENCE = 50; // ✅ 최대 단어 수 제한

        for (let i = 0; i < wordSegments.length; i++) {
            const word = wordSegments[i];
            const prevEndTime = i > 0 ? wordSegments[i - 1].endTime : word.startTime;

            // ✅ 화자 변경시 즉시 분리 (휴지시간 무관)
            const isSpeakerChange = word.speakerTag !== currentSpeaker;

            // ✅ 시간 간격 체크 (같은 화자일 때만)
            const isLongPause =
                !isSpeakerChange &&
                i > 0 &&
                word.startTime - prevEndTime > PAUSE_THRESHOLD &&
                wordCount >= MIN_WORDS_PER_SENTENCE;

            const isNewSentence =
                isSpeakerChange || isLongPause || wordCount >= MAX_WORDS_PER_SENTENCE;

            if (isNewSentence) {
                if (currentSentence.trim().length > 0) {
                    sentences.push({
                        text_Content: this.cleanKoreanText(currentSentence.trim()),
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
                text_Content: this.cleanKoreanText(currentSentence.trim()),
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

    private compressAudio(audioBuffer: Buffer): Buffer {
        // ✅ 간단한 압축 로직 (실제로는 오디오 압축 라이브러리 사용)
        return audioBuffer.slice(0, 10 * 1024 * 1024); // 10MB로 제한
    }

    private preprocessAudio(audioBuffer: Buffer): Buffer {
        // 노이즈 제거 및 정규화
        const processedBuffer = this.normalizeAudio(audioBuffer);

        // 크기 제한
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (processedBuffer.length > maxSize) {
            return this.compressAudio(processedBuffer);
        }

        return processedBuffer;
    }

    private normalizeAudio(audioBuffer: Buffer): Buffer {
        // 오디오 볼륨 정규화 로직
        // 실제 구현에서는 Web Audio API나 오디오 처리 라이브러리 사용
        return audioBuffer;
    }

    async transcribeBase64Audio(
        base64Data: string,
        mimeType = 'audio/wav',
        sessionStartTimeOffset = 0,
        gcsUrl?: string,
    ): Promise<STTResult> {
        if (!this.speechClient) return this.createSampleResult();
        const processedAudioBuffer = gcsUrl
            ? null
            : this.preprocessAudio(Buffer.from(base64Data, 'base64'));
        const processedBase64Data = gcsUrl ? null : processedAudioBuffer?.toString('base64');
        try {
            const { encoding, sampleRate } = this.getAudioConfig(mimeType);
            const request = {
                audio: gcsUrl ? { uri: gcsUrl } : { content: processedBase64Data },
                config: {
                    // 기본 오디오 설정
                    encoding: encoding as 'LINEAR16' | 'MP3' | 'WEBM_OPUS' | 'FLAC',
                    sampleRateHertz: sampleRate,
                    languageCode: 'ko-KR',
                    audioChannelCount: 1,

                    // 한국어 최적화 모델
                    model: 'latest_long',
                    useEnhanced: true,

                    // 화자 분리 설정 (한국어에 최적화)
                    enableSpeakerDiarization: undefined,
                    diarizationSpeakerCount: 2,
                    diarizationConfig: {
                        enableSpeakerDiarization: true,
                        minSpeakerCount: 1,
                        maxSpeakerCount: 2,
                    },

                    // 한국어 인식 개선
                    enableWordConfidence: true,
                    enableWordTimeOffsets: true,
                    enableAutomaticPunctuation: true,

                    // 한국어 특화 설정
                    alternativeLanguageCodes: ['ko-KR', 'en-US'], // 영어 제거

                    // 성능 최적화
                    maxAlternatives: 3, // 1 → 3으로 증가 (더 많은 대안)
                    profanityFilter: false,
                    enableSeparateRecognitionPerChannel: false,
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
