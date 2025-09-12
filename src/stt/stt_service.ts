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

    // 🆕 개선된 시간 정규화 (검증 포함)
    normalizeTimingsWithValidation(
        speakers: Array<{
            text_Content: string;
            startTime: number;
            endTime: number;
            speakerTag: number;
        }>,
        actualDuration: number,
        audioBufferLength?: number,
    ): Array<{ text_Content: string; startTime: number; endTime: number; speakerTag: number }> {
        if (speakers.length === 0) return speakers;

        const maxSttTime = Math.max(...speakers.map((s) => s.endTime));
        const scaleFactor = actualDuration / maxSttTime;

        // �� 스케일링 검증
        if (scaleFactor < 0.1 || scaleFactor > 10.0) {
            this.logger.warn(
                `비정상적인 스케일 팩터: ${scaleFactor.toFixed(1)} (duration: ${actualDuration.toFixed(1)}s, maxSttTime: ${maxSttTime.toFixed(1)}s)`,
            );
        }

        // 🆕 파일 크기 기반 추정과 비교 (MP4인 경우)
        if (audioBufferLength) {
            const estimatedDuration = audioBufferLength / 16000; // 기본 추정
            const durationRatio = actualDuration / estimatedDuration;

            if (durationRatio < 0.5 || durationRatio > 2.0) {
                this.logger.warn(
                    `Duration 비율 이상: ${durationRatio.toFixed(1)} (실제: ${actualDuration.toFixed(1)}s, 추정: ${estimatedDuration.toFixed(1)}s)`,
                );
            }
        }

        const normalizedSpeakers = speakers.map((speaker) => ({
            ...speaker,
            startTime: Math.round(speaker.startTime * scaleFactor * 10) / 10, // 소수점 첫째자리
            endTime: Math.round(speaker.endTime * scaleFactor * 10) / 10, // 소수점 첫째자리
        }));

        // 🆕 정규화 결과 검증
        const normalizedMaxTime = Math.max(...normalizedSpeakers.map((s) => s.endTime));
        const timeDifference = Math.abs(normalizedMaxTime - actualDuration);

        if (timeDifference > 1.0) {
            // 1초 이상 차이
            this.logger.warn(
                `정규화 후 시간 불일치: ${timeDifference.toFixed(1)}초 (목표: ${actualDuration.toFixed(1)}s, 실제: ${normalizedMaxTime.toFixed(1)}s)`,
            );
        }

        this.logger.log(
            `시간 정규화 완료: ${speakers.length}개 세그먼트, 스케일 팩터: ${scaleFactor.toFixed(1)}`,
        );

        return normalizedSpeakers;
    }

    // 기존 normalizeTimings 메서드도 유지 (호환성)
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

        // �� 기본 검증 추가
        if (scaleFactor < 0.1 || scaleFactor > 10.0) {
            this.logger.warn(`비정상적인 스케일 팩터: ${scaleFactor.toFixed(1)}`);
        }

        const normalizedSpeakers = speakers.map((speaker) => ({
            ...speaker,
            startTime: Math.round(speaker.startTime * scaleFactor * 10) / 10, // 소수점 첫째자리
            endTime: Math.round(speaker.endTime * scaleFactor * 10) / 10, // 소수점 첫째자리
        }));

        this.logger.log(
            `시간 정규화 완료: ${speakers.length}개 세그먼트, 스케일 팩터: ${scaleFactor.toFixed(1)}`,
        );

        return normalizedSpeakers;
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
                startTime: Math.round((speaker.startTime + sessionStartTimeOffset) * 10) / 10, // 소수점 첫째자리
                endTime: Math.round((speaker.endTime + sessionStartTimeOffset) * 10) / 10, // 소수점 첫째자리
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
        const qualityCheck = this.validateSTTResultQuality(sttResult);
        if (!qualityCheck.isValid) {
            this.logger.warn(
                `STT 결과 품질 경고: ${qualityCheck.issues.join(', ')} (신뢰도: ${(qualityCheck.confidence * 100).toFixed(1)}%)`,
            );
        } else {
            this.logger.log(
                `STT 결과 품질 양호 (신뢰도: ${(qualityCheck.confidence * 100).toFixed(1)}%)`,
            );
        }

        return sttResult;
    }
}
