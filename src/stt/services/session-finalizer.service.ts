import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { STTWithContextResponse } from '../entities/transcription';
import { STTSessionService } from './stt-seesion.service';
import { DatabaseService } from '../../database/database.service';
import { STTUtilService } from './stt-util.service';
import { GcsService } from '../../lib/gcs';
import { AudioProcessorUtil } from '../utils/audio-processer';

@Injectable()
export class SessionFinalizerService {
    private readonly logger = new Logger(SessionFinalizerService.name);

    constructor(
        private readonly sessionService: STTSessionService,
        private readonly databaseService: DatabaseService,
        private readonly utilService: STTUtilService,
        private readonly gcsService: GcsService,
    ) {}

    async finalize(
        canvasId: string,
        mentorIdx: number,
        menteeIdx: number,
        startTime: number,
    ): Promise<STTWithContextResponse> {
        try {
            this.logger.log(`최종 청크 처리 시작 - canvasId: ${canvasId}`);

            // 처리 완료 대기
            const result = await this.waitForAllChunksProcessed(canvasId);

            if (!result.allProcessed) {
                this.logger.warn(`일부 청크 미완료, 처리된 청크만 병합 - canvasId: ${canvasId}`);
            }

            const sessionKeys = result.sessionKeys;

            if (sessionKeys.length === 0) {
                this.logger.warn(`캐시 데이터 없음 - canvasId: ${canvasId}`);
                return this.createEmptyResponse(canvasId, mentorIdx, menteeIdx, startTime);
            }

            this.logger.log(`캐시 데이터 확인: ${sessionKeys.length}개 세션 발견`);

            // 처리 완료된 청크만 필터링 (순서 보장)
            const validChunks = sessionKeys.flatMap((key) => {
                const cached = this.sessionService.getCached(key);
                return (
                    cached?.chunks
                        .filter((chunk) => chunk.processing === false)
                        .sort((a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0)) || []
                );
            });

            this.logger.log(
                `병합 대상: ${validChunks.length}개 청크 (순서: ${validChunks.map((c) => c.chunkIndex).join(', ')})`,
            );

            if (validChunks.length === 0) {
                this.logger.warn('병합할 완료된 청크가 없음');
                return this.createEmptyResponse(canvasId, mentorIdx, menteeIdx, startTime);
            }

            // 모든 청크를 하나의 오디오로 합치기
            const mergedAudioUrl = await this.mergeAudioChunks(validChunks);

            // 최종 세션 생성
            const insertResult = await this.databaseService.execute(
                'INSERT INTO stt_transcriptions (canvas_id, mentor_idx, mentee_idx, audio_url) VALUES (?, ?, ?, ?)',
                [canvasId, mentorIdx, menteeIdx, mergedAudioUrl],
            );

            const finalSessionIdx = (insertResult as { insertId?: number })?.insertId;
            if (!finalSessionIdx) {
                throw new Error('최종 세션 생성 실패');
            }

            // 모든 세그먼트를 한 번에 저장
            const allSegments: Array<[number, number, string, number, number]> = [];
            for (const chunk of validChunks) {
                for (const speaker of chunk.speakers) {
                    if (speaker.startTime >= 0 && speaker.endTime > speaker.startTime) {
                        allSegments.push([
                            Number(finalSessionIdx),
                            Number(speaker.speakerTag),
                            speaker.text_content,
                            speaker.startTime,
                            speaker.endTime,
                        ]);
                    }
                }
            }

            // 배치로 모든 세그먼트 저장
            if (allSegments.length > 0) {
                await this.sessionService.batchInsertSegments(allSegments);
            }

            // 컨텍스트 텍스트 추출
            const contextText = this.utilService.extractContextText(
                allSegments.map(([, speakerTag, text, startTime, endTime]) => ({
                    speakerTag,
                    text_content: text,
                    text: text,
                    startTime,
                    endTime,
                })),
            );

            // 캐시 정리
            for (const sessionKey of sessionKeys) {
                this.sessionService.deleteFromCache(sessionKey);
            }

            this.logger.log(`최종 세션 생성 완료 - sessionIdx: ${finalSessionIdx}`);

            return {
                success: true,
                timestamp: new Date().toISOString(),
                processingTime: Date.now() - startTime,
                sttSessionIdx: Number(finalSessionIdx),
                contextText,
                audioUrl: mergedAudioUrl,
                segmentIndex: 0,
                speakers: [],
                transcript: '',
                confidence: 0,
                mentor_idx: mentorIdx,
                mentee_idx: menteeIdx,
                speakerInfo: { mentor: '', mentee: '' },
                canvasId: canvasId,
                sessionTimeInfo: {
                    canvasId: canvasId,
                    sessionKey: null,
                    startTime: null,
                    duration: 0,
                    elapsedMinutes: 0,
                    remainingTime: 0,
                    remainingMinutes: 0,
                    maxDuration: 0,
                    isExpired: false,
                    warningLevel: 'none',
                },
            };
        } catch (error) {
            this.logger.error('최종 청크 처리 실패:', error);
            throw new InternalServerErrorException(
                `최종 청크 처리 실패: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private async waitForAllChunksProcessed(canvasId: string): Promise<{
        success: boolean;
        sessionKeys: string[];
        allProcessed: boolean;
    }> {
        const maxWaitTime = 30000;
        const checkInterval = 500;
        const startWait = Date.now();

        this.logger.log(`청크 처리 완료 대기 시작 - canvasId: ${canvasId}`);

        while (Date.now() - startWait < maxWaitTime) {
            const sessionKeys = this.sessionService.findAllActiveSessionKeys(canvasId);

            if (sessionKeys.length > 0) {
                let processedChunks = 0;
                let processingChunks = 0;

                for (const key of sessionKeys) {
                    const cached = this.sessionService.getCached(key);
                    if (cached?.chunks) {
                        for (const chunk of cached.chunks) {
                            if (chunk.processing === false) {
                                processedChunks++;
                            } else if (chunk.processing === true) {
                                processingChunks++;
                            }
                        }
                    }
                }

                const allProcessed = processingChunks === 0 && processedChunks > 0;

                if (allProcessed) {
                    this.logger.log(`✅ 모든 청크 처리 완료 - ${processedChunks}개 완료`);
                    return {
                        success: true,
                        sessionKeys,
                        allProcessed: true,
                    };
                }

                const elapsedTime = Date.now() - startWait;
                if (elapsedTime > maxWaitTime * 0.8 && processedChunks > 0) {
                    this.logger.warn(
                        `⚠️ 부분 처리 허용 - 완료: ${processedChunks}, 처리중: ${processingChunks}`,
                    );
                    return {
                        success: true,
                        sessionKeys,
                        allProcessed: false,
                    };
                }
            }

            await new Promise((resolve) => setTimeout(resolve, checkInterval));
        }

        const finalSessionKeys = this.sessionService.findAllActiveSessionKeys(canvasId);
        this.logger.warn(`⏰ 청크 처리 대기 시간 초과`);

        return {
            success: false,
            sessionKeys: finalSessionKeys,
            allProcessed: false,
        };
    }

    private async mergeAudioChunks(
        chunks: Array<{
            audioUrl: string;
            speakers: Array<any>;
            duration: number;
        }>,
    ): Promise<string> {
        try {
            this.logger.log(`${chunks.length}개 청크 병합 시작`);

            if (!chunks || chunks.length === 0) {
                throw new Error('병합할 청크가 없습니다');
            }

            if (chunks.length === 1) {
                this.logger.log('단일 청크, 병합 생략');
                return chunks[0].audioUrl;
            }

            // 청크 다운로드 (병렬 처리)
            const downloadResults = await Promise.allSettled(
                chunks.map(async (chunk, index) => {
                    if (!chunk.audioUrl) {
                        throw new Error(`청크 ${index}: URL 없음`);
                    }

                    const response = await fetch(chunk.audioUrl);
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }

                    const buffer = Buffer.from(await response.arrayBuffer());
                    return { index, buffer, url: chunk.audioUrl };
                }),
            );

            // 성공한 다운로드만 필터링
            const successfulChunks = downloadResults
                .map((result, index) => {
                    if (result.status === 'fulfilled') {
                        return result.value;
                    } else {
                        this.logger.error(`청크 ${index} 다운로드 실패:`, result.reason);
                        return null;
                    }
                })
                .filter((chunk): chunk is NonNullable<typeof chunk> => chunk !== null)
                .sort((a, b) => a.index - b.index);

            if (successfulChunks.length === 0) {
                throw new Error('모든 청크 다운로드 실패');
            }

            this.logger.log(`${successfulChunks.length}/${chunks.length}개 청크 다운로드 성공`);

            // 오디오 병합
            const buffers = successfulChunks.map((chunk) => chunk.buffer);
            const mergedBuffer = AudioProcessorUtil.mergeAudioBuffersWav(buffers);

            if (!mergedBuffer || mergedBuffer.length === 0) {
                throw new Error('병합 결과가 비어있음');
            }

            this.logger.log(`오디오 병합 완료: ${mergedBuffer.length} bytes`);

            // GCS에 병합된 파일 업로드
            const mergedGcsKey = this.gcsService.generateGcsKey(
                `merged_session_${Date.now()}.wav`,
                'merged',
            );

            const uploadResult = await this.gcsService.uploadChunk(
                mergedBuffer,
                mergedGcsKey,
                'audio/wav',
            );

            if (!uploadResult.success) {
                throw new Error('병합 파일 업로드 실패');
            }

            this.logger.log(`청크 병합 완료: ${uploadResult.url}`);

            // 개별 청크 파일들 삭제
            try {
                const chunkUrls = successfulChunks.map((chunk) => chunk.url);
                const deleteResult = await this.gcsService.deleteMultipleFiles(chunkUrls);

                if (deleteResult.success) {
                    this.logger.log(`${deleteResult.deletedCount}개 청크 파일 삭제 완료`);
                } else {
                    this.logger.warn(`청크 파일 삭제 실패:`, deleteResult.errors);
                }
            } catch (deleteError) {
                this.logger.error('청크 파일 삭제 중 오류:', deleteError);
            }

            return uploadResult.url as string;
        } catch (error) {
            this.logger.error('청크 병합 실패:', error);

            // fallback: 첫 번째 유효한 청크 반환
            const validChunk = chunks.find((chunk) => chunk.audioUrl);
            if (validChunk) {
                this.logger.warn('Fallback: 첫 번째 청크 사용');
                return validChunk.audioUrl;
            }

            throw new Error('병합 및 fallback 모두 실패');
        }
    }

    private createEmptyResponse(
        canvasId: string,
        mentorIdx: number,
        menteeIdx: number,
        startTime: number,
    ): STTWithContextResponse {
        return {
            success: true,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime,
            sttSessionIdx: 0,
            contextText: '',
            audioUrl: '',
            transcript: '',
            confidence: 0,
            mentor_idx: mentorIdx,
            mentee_idx: menteeIdx,
            speakerInfo: { mentor: '', mentee: '' },
            canvasId: canvasId,
            segmentIndex: 0,
            speakers: [],
            sessionTimeInfo: {
                canvasId: canvasId,
                sessionKey: null,
                startTime: null,
                duration: 0,
                elapsedMinutes: 0,
                remainingTime: 0,
                remainingMinutes: 0,
                maxDuration: 0,
                isExpired: false,
                warningLevel: 'none',
            },
        };
    }
}
