import { Injectable, Logger } from '@nestjs/common';
import { GoogleSpeechProvider } from './providers/google-speech';
import { AudioProcessorUtil } from './utils/audio-processer';
import { TextProcessorUtil } from './utils/text_processor';
import { TranscriptionResult, STTResult } from './entities/transcription';
import { SpeechPatternsUtil } from './utils/speech-patterms';
import { PynoteService } from './providers/pynote.service';

@Injectable()
export class STTService {
    private readonly logger = new Logger(STTService.name);

    constructor(
        private readonly googleSpeechProvider: GoogleSpeechProvider,
        private readonly pynoteService: PynoteService,
    ) {}

    async transcribeAudioBuffer(
        audioBuffer: Buffer,
        mimeType = 'audio/mp4',
        sessionStartTimeOffset = 0,
        gcsUrl?: string,
        usePynoteDiarization = false,
    ): Promise<STTResult> {
        if (usePynoteDiarization && gcsUrl) {
            return await this.transcribeAudioFromGcs(
                gcsUrl,
                mimeType,
                sessionStartTimeOffset,
                true,
            );
        }

        // 기존 방식
        const base64Data = audioBuffer.toString('base64');
        const audioData = this.prepareAudioData(base64Data, gcsUrl);
        const config = this.createAudioConfig(mimeType);
        const result = await this.googleSpeechProvider.transcribe(audioData, config, gcsUrl);

        return this.adjustTimings(result, sessionStartTimeOffset);
    }

    private async transcribeWithPynoteDiarizationFromGcs(
        gcsUrl: string,
        mimeType: string,
        sessionStartTimeOffset: number,
        canvasId: string,
        mentorIdx?: number,
        menteeIdx?: number,
    ): Promise<STTResult> {
        try {
            this.logger.log('�� pynote GCS 세그먼트 분리 + 세그먼트별 STT 시작');

            // 1. pynote에서 GCS URL로 세그먼트 분리
            const segmentResult = await this.pynoteService.getSegmentsFromGcs(
                gcsUrl,
                canvasId, // 임시 캔버스 ID
                mentorIdx || 1,
                menteeIdx || 2,
                sessionStartTimeOffset,
            );

            if (!segmentResult.success || segmentResult.segments.length === 0) {
                throw new Error('pynote 세그먼트 분리 실패');
            }

            this.logger.log(
                `✅ pynote 세그먼트 분리 완료: ${segmentResult.segments.length}개 세그먼트`,
            );

            // 2. 각 세그먼트 버퍼로 STT 실행
            const allSpeakers: Array<{
                text_Content: string;
                startTime: number;
                endTime: number;
                speakerTag: number;
                confidence?: number;
            }> = [];

            for (let i = 0; i < segmentResult.segments.length; i++) {
                const segment = segmentResult.segments[i];
                this.logger.log(
                    `�� 세그먼트 ${i + 1}/${segmentResult.segments.length} STT 처리 시작`,
                );

                try {
                    const audioBuffer = Buffer.from(segment.audioBuffer, 'base64');

                    // Google Speech로 세그먼트 STT 실행
                    const base64Data = audioBuffer.toString('base64');
                    const audioData = this.prepareAudioData(base64Data, '');
                    const config = this.createAudioConfigWithoutDiarization(mimeType);
                    const sttResult = await this.googleSpeechProvider.transcribe(audioData, config);

                    // 세그먼트 결과를 전체 결과에 추가
                    if (sttResult.speakers && sttResult.speakers.length > 0) {
                        for (const speaker of sttResult.speakers) {
                            allSpeakers.push({
                                ...speaker,
                                speakerTag: segment.speakerTag,
                                startTime:
                                    sessionStartTimeOffset + segment.startTime + speaker.startTime,
                                endTime:
                                    sessionStartTimeOffset + segment.startTime + speaker.endTime,
                            });
                        }
                    } else if (sttResult.transcript) {
                        // STT 결과가 있지만 speakers가 없는 경우
                        allSpeakers.push({
                            text_Content: sttResult.transcript,
                            speakerTag: segment.speakerTag,
                            startTime: sessionStartTimeOffset + segment.startTime,
                            endTime: sessionStartTimeOffset + segment.endTime,
                            confidence: sttResult.confidence || 0.9,
                        });
                    }

                    this.logger.log(`✅ 세그먼트 ${i + 1} STT 완료: "${sttResult.transcript}"`);
                } catch (segmentError) {
                    this.logger.error(
                        `❌ 세그먼트 ${i + 1} STT 실패: ${segmentError instanceof Error ? segmentError.message : String(segmentError)}`,
                    );
                    // 실패한 세그먼트는 건너뛰고 계속 진행
                }
            }

            this.logger.log(
                `✅ pynote 세그먼트 분리 + STT 처리 완료: ${allSpeakers.length}개 세그먼트`,
            );

            return {
                transcript: allSpeakers.map((s) => s.text_Content).join(' '),
                confidence: 0.9,
                speakers: allSpeakers,
            };
        } catch (error: unknown) {
            this.logger.error(
                `pynote GCS 세그먼트 분리 + STT 처리 실패: ${error instanceof Error ? error.message : String(error)}`,
            );

            // fallback to Google Speech
            return await this.transcribeWithGoogleSpeech(gcsUrl, mimeType);
        }
    }

    // �� Google Speech 직접 사용 (fallback용)
    private async transcribeWithGoogleSpeech(gcsUrl: string, mimeType: string): Promise<STTResult> {
        try {
            this.logger.log('🔄 Google Speech 직접 사용 (fallback)');

            const audioData = this.prepareAudioData('', gcsUrl);
            const config = this.createAudioConfig(mimeType);
            const result = await this.googleSpeechProvider.transcribe(audioData, config, gcsUrl);

            return this.adjustTimings(result, 0);
        } catch (error) {
            this.logger.error(
                `Google Speech fallback 실패: ${error instanceof Error ? error.message : String(error)}`,
            );
            throw error;
        }
    }

    async transcribeAudioFromGcs(
        gcsUrl: string,
        mimeType = 'audio/mp4',
        sessionStartTimeOffset = 0,
        usePynoteDiarization = true,
        canvasId?: string,
        mentorIdx?: number,
        menteeIdx?: number,
    ): Promise<STTResult> {
        if (usePynoteDiarization) {
            return await this.transcribeWithPynoteDiarizationFromGcs(
                gcsUrl,
                mimeType,
                sessionStartTimeOffset,
                canvasId || 'resume-room',
                mentorIdx,
                menteeIdx,
            );
        }

        // 기존 방식 (GCS URL 사용)
        const audioData = this.prepareAudioData('', gcsUrl);
        const config = this.createAudioConfig(mimeType);
        const result = await this.googleSpeechProvider.transcribe(audioData, config, gcsUrl);

        return this.adjustTimings(result, sessionStartTimeOffset);
    }

    // 🆕 화자분리 비활성화된 설정 생성
    private createAudioConfigWithoutDiarization(mimeType: string) {
        const baseConfig = this.createAudioConfig(mimeType);
        return {
            ...baseConfig,
            enableSpeakerDiarization: false, // 화자분리 비활성화
            diarizationSpeakerCount: 0,
            enableWordTimeOffsets: true, // ← 이 줄 추가!
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

        return sttResult;
    }
}
