// 파일 상단에 추가
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { GoogleSpeechProvider } from './providers/google-speech';
import { AudioProcessorUtil } from './utils/audio-processer';
import { TextProcessorUtil } from './utils/text_processor';
import { TranscriptionResult, STTResult } from './entities/transcription';
import { SpeechPatternsUtil } from './utils/speech-patterms';
import { PynoteService } from './providers/pynote.service';
import { DatabaseService } from '@/database/database.service';

@Injectable()
export class STTService {
    private readonly logger = new Logger(STTService.name);

    constructor(
        private readonly googleSpeechProvider: GoogleSpeechProvider,
        private readonly pynoteService: PynoteService,
        private readonly db: DatabaseService,
    ) {}

    async transcribeAudioBuffer(
        audioBuffer: Buffer,
        mimeType = 'audio/wav',
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

    // 82라인부터 127라인까지 교체
    private async transcribeWithPynoteDiarizationFromGcs(
        gcsUrl: string,
        mimeType: string,
        sessionStartTimeOffset: number,
        canvasId: string,
        mentorIdx?: number,
        menteeIdx?: number,
    ): Promise<STTResult> {
        try {
            this.logger.log('pynote GCS 세그먼트 분리 + 병렬 STT 시작');

            // 1. pynote에서 GCS URL로 세그먼트 분리
            const segmentResult = await this.pynoteService.getSegmentsFromGcs(
                gcsUrl,
                canvasId,
                mentorIdx || 1,
                menteeIdx || 2,
                sessionStartTimeOffset,
            );

            if (!segmentResult.success || segmentResult.segments.length === 0) {
                throw new Error('pynote 세그먼트 분리 실패');
            }

            this.logger.log(
                `pynote 세그먼트 분리 완료: ${segmentResult.segments.length}개 세그먼트`,
            );

            // 2. 병렬 STT 처리 (순서 보장)
            const parallelStartTime = Date.now();

            const sttPromises = segmentResult.segments.map(async (segment, originalIndex) => {
                if (process.env.NODE_ENV === 'development') {
                    this.logger.log(`세그먼트 ${originalIndex + 1} STT 처리 시작 (병렬)`);
                }

                try {
                    const audioBuffer = Buffer.from(segment.audioBuffer, 'base64');
                    const base64Data = audioBuffer.toString('base64');
                    const audioData = this.prepareAudioData(base64Data, '');
                    const config = this.createAudioConfigWithoutDiarization(mimeType);

                    const sttResult = await this.googleSpeechProvider.transcribe(audioData, config);

                    if (process.env.NODE_ENV === 'development') {
                        this.logger.log(`세그먼트 ${originalIndex + 1} STT 완료`);
                    }

                    return {
                        originalIndex,
                        segment,
                        sttResult,
                        success: true,
                    };
                } catch (error) {
                    this.logger.error(`세그먼트 ${originalIndex + 1} STT 실패:`, error);
                    return {
                        originalIndex,
                        segment,
                        error,
                        success: false,
                    };
                }
            });

            // 3. 병렬 실행 후 순서 복원
            this.logger.log(`${segmentResult.segments.length}개 세그먼트 병렬 처리 시작...`);
            const results = await Promise.allSettled(sttPromises);
            const parallelTime = Date.now() - parallelStartTime;

            const successResults = results
                .filter(
                    (result): result is PromiseFulfilledResult<any> =>
                        result.status === 'fulfilled' && result.value.success,
                )
                .map((result) => result.value)
                .sort((a, b) => a.originalIndex - b.originalIndex);

            this.logger.log(
                `병렬 처리 완료: ${successResults.length}/${segmentResult.segments.length}개 성공, 소요시간: ${parallelTime}ms`,
            );

            // 4. 결과 조합 (전체 텍스트 우선 사용)
            const allSpeakers: Array<{
                text_Content: string;
                startTime: number;
                endTime: number;
                speakerTag: number;
                confidence?: number;
            }> = [];

            for (const { segment, sttResult } of successResults) {
                const baseStartTime = sessionStartTimeOffset + segment.startTime;

                // 🆕 전체 텍스트 우선 사용 전략
                if (sttResult.transcript && sttResult.transcript.trim()) {
                    // 전체 transcript가 있으면 우선 사용
                    allSpeakers.push({
                        text_Content: sttResult.transcript.trim(),
                        speakerTag: segment.speakerTag,
                        startTime: baseStartTime,
                        endTime: sessionStartTimeOffset + segment.endTime,
                        confidence: sttResult.confidence || 0.9,
                    });
                } else if (sttResult.speakers && sttResult.speakers.length > 0) {
                    // transcript가 없으면 speakers 배열 사용
                    for (const speaker of sttResult.speakers) {
                        allSpeakers.push({
                            text_Content: speaker.text_Content || '',
                            speakerTag: segment.speakerTag,
                            startTime: baseStartTime + (speaker.startTime || 0),
                            endTime: baseStartTime + (speaker.endTime || 0),
                            confidence: speaker.confidence || 0.9,
                        });
                    }

                    const speakersText = sttResult.speakers.map((s) => s.text_Content).join(' ');
                    this.logger.log(`speakers 배열 사용: "${speakersText.substring(0, 50)}..."`);
                } else {
                    // 둘 다 없으면 빈 텍스트로 플레이스홀더 생성
                    allSpeakers.push({
                        text_Content: '[음성 인식 실패]',
                        speakerTag: segment.speakerTag,
                        startTime: baseStartTime,
                        endTime: sessionStartTimeOffset + segment.endTime,
                        confidence: 0.1,
                    });

                    this.logger.warn(`⚠️ 세그먼트 텍스트 없음, 플레이스홀더 생성`);
                }
            }

            // 5. 최종 startTime 기준 정렬
            allSpeakers.sort((a, b) => a.startTime - b.startTime);

            // 6. 결과 반환
            const combinedTranscript = allSpeakers
                .map((s) => s.text_Content)
                .filter((text) => text && text !== '[음성 인식 실패]')
                .join(' ');

            this.logger.log(
                `✅ pynote 병렬 STT 처리 완료: ${allSpeakers.length}개 세그먼트, 성공률: ${((successResults.length / segmentResult.segments.length) * 100).toFixed(1)}%`,
            );

            return {
                transcript: combinedTranscript,
                confidence: 0.9,
                speakers: allSpeakers,
            };
        } catch (error: unknown) {
            this.logger.error(
                `pynote GCS 병렬 처리 실패: ${error instanceof Error ? error.message : String(error)}`,
            );

            // fallback to Google Speech
            return await this.transcribeWithGoogleSpeech(gcsUrl, mimeType, sessionStartTimeOffset);
        }
    }

    // �� Google Speech 직접 사용 (fallback용)
    private async transcribeWithGoogleSpeech(
        gcsUrl: string,
        mimeType: string,
        sessionStartTimeOffset: number,
    ): Promise<STTResult> {
        try {
            this.logger.log('🔄 Google Speech 직접 사용 (fallback)');

            const audioData = this.prepareAudioData('', gcsUrl);
            const config = this.createAudioConfig(mimeType);
            const result = await this.googleSpeechProvider.transcribe(audioData, config, gcsUrl);

            return this.adjustTimings(result, sessionStartTimeOffset);
        } catch (error) {
            this.logger.error(
                `Google Speech fallback 실패: ${error instanceof Error ? error.message : String(error)}`,
            );
            throw error;
        }
    }

    async transcribeAudioFromGcs(
        gcsUrl: string,
        mimeType = 'audio/wav',
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
        if (mimeType.includes('wav') || mimeType.includes('wav')) {
            return {
                encoding: 'LINEAR16', // MP3 인코딩 사용
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

    // 간단한 사용자 역할 확인 함수
    async getCanvasUserRoles(canvasId: string) {
        if (!canvasId) {
            throw new BadRequestException('canvasId is required');
        }

        // 캔버스 참여자 조회 (더 간단하고 안전한 방법)
        const participants = await this.db.query<{ user_id: number; role: string }>(
            `SELECT user_id, role FROM canvas_participant WHERE canvas_id = ?`,
            [canvasId],
        );

        const mentor = participants.find((p) => p.role === 'owner')?.user_id;
        const mentee = participants.find((p) => p.role === 'editor')?.user_id;

        return {
            mentor,
            mentee,
        };
    }
}
