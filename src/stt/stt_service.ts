import { Injectable, Logger } from '@nestjs/common';
import { GoogleSpeechProvider } from './providers/google-speech';
import { AudioProcessorUtil } from './utils/audio-processer';
import { TextProcessorUtil } from './utils/text_processor';
import { TranscriptionResult, ConnectionTestResult, STTResult } from './entities/transcription';
import { SpeechPatternsUtil } from './utils/speech-patterms';

@Injectable()
export class STTService {
    private readonly logger = new Logger(STTService.name);

    constructor(private readonly googleSpeechProvider: GoogleSpeechProvider) {}

    async transcribeAudioBuffer(
        audioBuffer: Buffer,
        mimeType = 'audio/mp4',
        sessionStartTimeOffset = 0,
        gcsUrl?: string,
    ): Promise<STTResult> {
        const base64Data = audioBuffer.toString('base64');
        return this.transcribeBase64Audio(base64Data, mimeType, sessionStartTimeOffset, gcsUrl);
    }

    async transcribeBase64Audio(
        base64Data: string,
        mimeType = 'audio/mp4',
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

    // 🆕 STT 결과 품질 검증
    validateSTTResultQuality(
        result: STTResult,
        expectedDuration?: number,
    ): {
        isValid: boolean;
        confidence: number;
        issues: string[];
    } {
        const issues: string[] = [];
        let confidence = 1.0;

        // 1. 기본 신뢰도 검증
        if (result.confidence < 0.5) {
            issues.push(`낮은 STT 신뢰도: ${(result.confidence * 100).toFixed(1)}%`);
            confidence *= 0.5;
        }

        // 2. 스피커 세그먼트 검증
        if (result.speakers && result.speakers.length > 0) {
            // 시간 순서 검증
            for (let i = 1; i < result.speakers.length; i++) {
                if (result.speakers[i].startTime < result.speakers[i - 1].endTime) {
                    issues.push(`시간 순서 문제: 세그먼트 ${i}가 이전 세그먼트와 겹침`);
                    confidence *= 0.8;
                }
            }

            // 예상 duration과 비교
            if (expectedDuration && expectedDuration > 0) {
                const maxTime = Math.max(...result.speakers.map((s) => s.endTime));
                const timeDifference = Math.abs(maxTime - expectedDuration);
                const timeRatio = timeDifference / expectedDuration;

                if (timeRatio > 0.2) {
                    issues.push(
                        `시간 불일치: STT 최대시간 ${maxTime.toFixed(1)}s vs 예상 ${expectedDuration.toFixed(1)}s`,
                    );
                    confidence *= 0.7;
                }
            }

            // 스피커 태그 검증
            const speakerTags = new Set(result.speakers.map((s) => s.speakerTag));
            if (speakerTags.size > 2) {
                issues.push(`스피커 수 이상: ${speakerTags.size}명 감지됨`);
                confidence *= 0.9;
            }
        }

        return {
            isValid: confidence > 0.6,
            confidence,
            issues,
        };
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
        // 원래는 단순히 base64 데이터를 그대로 반환했을 것
        return base64Data; // ← 이제 원래대로 단순히 base64 반환
    }

    private createAudioConfig(mimeType: string) {
        // MP4/M4A 파일의 경우 다른 설정 사용
        if (mimeType.includes('mp4') || mimeType.includes('m4a')) {
            return {
                encoding: 'MP3', // MP3 인코딩 사용
                sampleRate: 44100,
                languageCode: 'ko-KR',
                enableSpeakerDiarization: true,
                diarizationSpeakerCount: 2,
                enableAutomaticPunctuation: false,
                maxAlternatives: 1,
                speechContexts: [], // 빈 배열로 설정
            };
        }

        // 다른 포맷들
        let encoding: 'LINEAR16' | 'MP3' | 'WEBM_OPUS' | 'FLAC' = 'LINEAR16';
        if (mimeType.includes('mp3')) {
            encoding = 'MP3';
        } else if (mimeType.includes('webm') || mimeType.includes('opus')) {
            encoding = 'WEBM_OPUS';
        } else if (mimeType.includes('flac')) {
            encoding = 'FLAC';
        }

        return {
            encoding,
            sampleRate: 44100,
            languageCode: 'ko-KR',
            enableSpeakerDiarization: true,
            diarizationSpeakerCount: 2,
            enableAutomaticPunctuation: true,
            minSpeakerCount: 2,
            maxSpeakerCount: 2,
            enableWordTimeOffsets: true, // 🆕 추가
            useEnhanced: true,
            maxAlternatives: 1,
            speechContexts: SpeechPatternsUtil.SPEECH_CONTEXTS,
        };
    }

    private adjustTimings(result: TranscriptionResult, sessionStartTimeOffset: number): STTResult {
        // TranscriptionResult를 STTResult로 변환
        let speakers: Array<{
            text_Content: string;
            startTime: number;
            endTime: number;
            speakerTag: number;
        }> =
            result.speakers?.map((speaker) => ({
                text_Content: speaker.text_Content,
                startTime: Math.round((speaker.startTime + sessionStartTimeOffset) * 10) / 10,
                endTime: Math.round((speaker.endTime + sessionStartTimeOffset) * 10) / 10,
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

        // 🆕 STT 결과 품질 검증
        if (result.confidence < 0.7) {
            // 낮은 신뢰도일 때만 검증
            const qualityCheck = this.validateSTTResultQuality(sttResult);
            if (!qualityCheck.isValid) {
                this.logger.warn(`STT 결과 품질 경고: ${qualityCheck.issues.join(', ')}`);
            }
        }

        return sttResult;
    }
}
