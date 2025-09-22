// 파일 상단에 추가
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import {
    STTWithContextResponse,
    TranscribeChunkRequest,
    ChunkCacheData,
} from '../entities/transcription';
import { STTService } from '../stt_service';
import { STTSessionService } from './stt-seesion.service';
import { GcsService } from '../../lib/gcs';
import { AudioDurationService } from './audio-duration.service';
import { STTUtilService } from './stt-util.service';
import { TimeCheckResult } from './session-timer.service';
import { STTResult } from '../entities/transcription';

// 세션 데이터 타입 확장
interface SessionData extends ChunkCacheData {
    sessionKey: string;
}

@Injectable()
export class AudioChunkProcessorService {
    private readonly logger = new Logger(AudioChunkProcessorService.name);

    constructor(
        private readonly sttService: STTService,
        private readonly sessionService: STTSessionService,
        private readonly gcsService: GcsService,
        private readonly audioDurationService: AudioDurationService,
        private readonly utilService: STTUtilService,
    ) {}

    async process(
        body: TranscribeChunkRequest,
        audioData: string,
        mimeType: string,
        canvasId: string,
        actualMentorIdx: number,
        actualMenteeIdx: number,
        usePynoteDiarization: boolean,
        startTime: number,
        timeCheck: TimeCheckResult,
    ): Promise<STTWithContextResponse> {
        const audioBuffer = Buffer.from(audioData, 'base64');

        // 세션 관리
        const session = this.getOrCreateSession(canvasId, actualMentorIdx, actualMenteeIdx, body);

        // 처리 중 청크 등록
        const processingChunk = {
            audioUrl: '',
            speakers: [],
            duration: 0,
            processing: true,
            chunkIndex: body.chunkIndex,
        };

        session.chunks.push(processingChunk);
        this.sessionService.addToCache(session.sessionKey, session);

        try {
            // WAV 파일의 정확한 총 길이 추출
            const exactWavDuration = await this.audioDurationService.getExactDuration(
                audioBuffer,
                mimeType,
            );

            // 세션 시작 오프셋 계산
            const sessionStartOffset = this.calculateSessionOffset(session.chunks);

            this.logger.log(
                `시간 매핑 - WAV 길이: ${exactWavDuration.toFixed(3)}초, 오프셋: ${sessionStartOffset.toFixed(3)}초`,
            );

            // GCS 업로드
            const gcsKey = this.gcsService.generateGcsKey(
                `voice_chunk_${session.segmentIndex}_${body.chunkIndex}.wav`,
                canvasId,
                actualMentorIdx,
                actualMenteeIdx,
            );

            const gcsResult = await this.gcsService.uploadChunk(audioBuffer, gcsKey, mimeType);

            if (!gcsResult?.success || !gcsResult.url) {
                throw new Error('오디오 업로드 실패');
            }

            // STT + 화자 분리 처리
            const sttResult: STTResult = await this.sttService.transcribeAudioFromGcs(
                gcsResult.url,
                mimeType,
                sessionStartOffset,
                usePynoteDiarization,
                canvasId,
                actualMentorIdx,
                actualMenteeIdx,
            );

            this.logger.log(`GCS 업로드 완료: ${gcsResult.url}`);

            // 화자 데이터 처리
            let mappedSpeakers = sttResult.speakers || [];
            if (usePynoteDiarization) {
                this.logger.log(`pyannote 시간 사용: ${mappedSpeakers.length}개 세그먼트`);
            } else {
                // Google STT만 사용할 때 정규화 적용
                if (exactWavDuration > 0 && mappedSpeakers.length > 0) {
                    const sttDuration = Math.max(
                        ...mappedSpeakers.map((speaker) => speaker.endTime),
                    );
                    mappedSpeakers = this.audioDurationService.mapSTTTimingsToFullDuration(
                        mappedSpeakers,
                        sttDuration,
                        exactWavDuration,
                        0,
                    );
                }
            }

            // 처리 완료 후 캐시 업데이트
            this.markChunkComplete(
                session,
                body.chunkIndex,
                gcsResult.url,
                mappedSpeakers,
                exactWavDuration,
            );

            this.logger.log(`💾 캐시 저장 시작 - sessionKey: ${session.sessionKey}`);
            this.logger.log(`📊 mappedSpeakers: ${JSON.stringify(mappedSpeakers.slice(0, 2))}`);

            return this.buildResponse(
                sttResult,
                gcsResult.url,
                session,
                mappedSpeakers,
                actualMentorIdx,
                actualMenteeIdx,
                canvasId,
                timeCheck,
                startTime,
            );
        } catch (error) {
            this.cleanupFailedChunk(session, body.chunkIndex);
            throw error;
        }
    }

    private getOrCreateSession(
        canvasId: string,
        mentorIdx: number,
        menteeIdx: number,
        body: TranscribeChunkRequest,
    ): SessionData {
        let sessionKey = this.sessionService.findActiveSessionKey(canvasId);
        let segmentIndex = 1;

        if (!sessionKey) {
            segmentIndex = this.sessionService.getMaxSegmentIndex(canvasId) + 1;
            sessionKey = this.generateSessionKey(canvasId);
            this.logger.log(`새 세션 시작 - canvasId: ${canvasId}, segmentIndex: ${segmentIndex}`);
        } else {
            this.logger.log(`기존 세션 사용 - canvasId: ${canvasId}, sessionKey: ${sessionKey}`);
        }

        let cached = this.sessionService.getCached(sessionKey);
        if (!cached) {
            cached = {
                mentorIdx,
                menteeIdx,
                chunks: [],
                segmentIndex,
                lastActivity: Date.now(),
                sessionStartTime: Date.now(),
            };
        } else if (body.isNewRecordingSession) {
            cached.segmentIndex += 1;
            cached.lastActivity = Date.now();
            this.logger.log(
                `새 세그먼트 시작 - canvasId: ${canvasId}, segmentIndex: ${cached.segmentIndex}`,
            );
        } else {
            cached.lastActivity = Date.now();
        }

        return { ...cached, sessionKey };
    }

    private calculateSessionOffset(chunks: any[]): number {
        let sessionStartOffset = 0;
        for (const chunk of chunks) {
            if (chunk.duration && chunk.duration > 0) {
                sessionStartOffset += chunk.duration;
            }
        }
        return sessionStartOffset;
    }

    private markChunkComplete(
        session: SessionData,
        chunkIndex: number,
        audioUrl: string,
        speakers: any[],
        duration: number,
    ): void {
        const chunkIdx = session.chunks.findIndex(
            (chunk) => chunk.chunkIndex === chunkIndex && chunk.processing === true,
        );

        if (chunkIdx !== -1) {
            session.chunks[chunkIdx] = {
                audioUrl: audioUrl || '',
                speakers: speakers.map((speaker) => ({
                    ...speaker,
                    text_content: speaker.text_Content,
                })),
                duration: duration,
                processing: false,
                chunkIndex: chunkIndex,
            };

            this.sessionService.addToCache(session.sessionKey, session);
            this.logger.log(`✅ 청크 처리 완료 - chunkIndex: ${chunkIndex}`);
        }
    }

    private cleanupFailedChunk(session: SessionData, chunkIndex: number): void {
        const errorChunkIndex = session.chunks.findIndex(
            (chunk) => chunk.chunkIndex === chunkIndex && chunk.processing === true,
        );
        if (errorChunkIndex !== -1) {
            session.chunks.splice(errorChunkIndex, 1);
            this.sessionService.addToCache(session.sessionKey, session);
            this.logger.error(`❌ 청크 처리 실패, 캐시에서 제거 - chunkIndex: ${chunkIndex}`);
        }
    }

    private generateSessionKey(canvasId: string): string {
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(2, 8);
        return `${canvasId}_${timestamp}_${randomId}`;
    }

    private buildResponse(
        sttResult: STTResult,
        gcsUrl: string,
        session: SessionData,
        mappedSpeakers: any[],
        mentorIdx: number,
        menteeIdx: number,
        canvasId: string,
        timeCheck: TimeCheckResult,
        startTime: number,
    ): STTWithContextResponse {
        return {
            success: true,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime,
            sttSessionIdx: 0,
            contextText: '',
            audioUrl: gcsUrl,
            segmentIndex: session.segmentIndex,
            speakers: mappedSpeakers.map((speaker) => ({
                ...speaker,
                text_content: speaker.text_Content,
            })),
            transcript: '',
            confidence: 0,
            mentor_idx: mentorIdx,
            mentee_idx: menteeIdx,
            speakerInfo: { mentor: '', mentee: '' },
            canvasId: canvasId,
            sessionTimeInfo: timeCheck.timeInfo,
            timeWarning: timeCheck.shouldWarn
                ? {
                      level:
                          timeCheck.timeInfo.warningLevel === 'critical' ? 'critical' : 'warning',
                      message: timeCheck.message,
                      remainingMinutes: timeCheck.timeInfo.remainingMinutes,
                  }
                : undefined,
        };
    }
}
