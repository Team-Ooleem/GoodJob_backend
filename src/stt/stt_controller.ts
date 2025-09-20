import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Query,
    BadRequestException,
    InternalServerErrorException,
    Logger,
    UploadedFile,
    UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { STTService } from './stt_service';
import { STTResponseDto, STTResultDto } from './dto/transcribe-response';
import { FileInterceptor } from '@nestjs/platform-express';
import { TranscribeBase64RequestDto } from './dto/transcribe-request';
import { GcsService } from '../lib/gcs';
import { DatabaseService } from '../database/database.service';
import type {
    TranscribeChunkRequest,
    STTWithContextResponse,
    SessionUserResponse,
    STTResult,
} from './entities/transcription';
import { STTSessionService } from './services/stt-seesion.service';
import { STTMessageService } from './services/stt-message.service';
import { STTUtilService } from './services/stt-util.service';
import { AudioProcessorUtil } from './utils/audio-processer';
import { AudioDurationService } from './services/audio-duration.service';

@ApiTags('Speech-to-Text')
@Controller('stt')
export class STTController {
    private readonly logger = new Logger(STTController.name);

    constructor(
        private readonly sttService: STTService,
        private readonly gcsService: GcsService,
        private readonly databaseService: DatabaseService,
        private readonly sessionService: STTSessionService,
        private readonly messageService: STTMessageService,
        private readonly utilService: STTUtilService,
        private readonly audioDurationService: AudioDurationService,
    ) {}

    private logFlags = {
        requestLogged: false,
        completionLogged: false,
        errorLogged: false,
    };
    // ========================
    // 핵심 STT API
    // =======================
    @Post('transcribe-with-context')
    @ApiOperation({ summary: '화자 분리 + 컨텍스트 추출 + DB 저장 (청크 지원)' })
    async transcribeWithContext(
        @Body() body: TranscribeChunkRequest,
    ): Promise<STTWithContextResponse> {
        const {
            audioData,
            mimeType = 'audio/wav',
            canvasId,
            mentorIdx,
            menteeIdx,
            isFinalChunk = false,
            usePynoteDiarization = true,
        } = body;

        // canvasId 유효성 검사
        if (!canvasId) {
            throw new BadRequestException('canvasId가 필요합니다');
        }

        // 참가자 정보 조회
        const participants = await this.getParticipants(canvasId);
        const actualMentorIdx = participants.mentor?.user_id || mentorIdx;
        const actualMenteeIdx = participants.mentee?.user_id || menteeIdx;

        this.logger.log(`STT 요청 받음 - canvasId: ${canvasId}, isFinalChunk: ${isFinalChunk}`);

        // 오디오 데이터가 있는 경우에만 검증
        if (audioData) {
            if (!this.utilService.isValidBase64(audioData)) {
                throw new BadRequestException('유효하지 않은 Base64');
            }
        }

        const startTime = Date.now();

        try {
            // 오디오 데이터가 있으면 정상적인 청크 처리
            if (audioData) {
                const chunkResult = await this.processAudioChunk(
                    body,
                    audioData,
                    mimeType,
                    canvasId,
                    actualMentorIdx,
                    actualMenteeIdx,
                    usePynoteDiarization,
                    startTime,
                );

                // 🔧 수정: 최종 청크일 때만 병합 (자동 병합 비활성화)
                const shouldMerge = isFinalChunk;

                if (shouldMerge) {
                    this.logger.log('병합 처리 시작 (최종 청크)');
                    return await this.handleFinalChunk(
                        canvasId,
                        actualMentorIdx,
                        actualMenteeIdx,
                        startTime,
                    );
                }

                return chunkResult;
            } else if (isFinalChunk) {
                // 오디오 데이터 없이 최종 청크만 온 경우
                this.logger.log('최종 청크 신호 수신 (오디오 데이터 없음), 병합 처리 시작');
                return await this.handleFinalChunk(
                    canvasId,
                    actualMentorIdx,
                    actualMenteeIdx,
                    startTime,
                );
            } else {
                throw new BadRequestException('오디오 데이터가 필요합니다');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`STT 실패: ${errorMessage}`);
            throw new InternalServerErrorException(`STT 처리 실패: ${errorMessage}`);
        }
    }

    // 참가자 정보 조회 헬퍼 함수
    private async getParticipants(canvasId: string) {
        const participants = (await this.databaseService.execute(
            `
            SELECT 
                cp.user_id,
                mp.mentor_idx,
                mp.is_approved
            FROM canvas_participant cp
            LEFT JOIN mentor_profiles mp ON cp.user_id = mp.mentor_idx
            WHERE cp.canvas_id = ?
        `,
            [canvasId],
        )) as Array<{ user_id: number; mentor_idx: number | null; is_approved: number | null }>;

        const mentor = participants.find((p) => p.mentor_idx && p.is_approved === 1) || null;
        const mentee = participants.find((p) => !p.mentor_idx || p.is_approved !== 1) || null;

        return { mentor, mentee };
    }

    // 세그먼트 인덱스 생성
    private getNextSegmentIndex(canvasId: string): number {
        return this.sessionService.getMaxSegmentIndex(canvasId) + 1;
    }

    // 세션 키 생성
    private generateSessionKey(canvasId: string): string {
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(2, 8);
        return `${canvasId}_${timestamp}_${randomId}`;
    }

    // 오디오 청크 처리 함수
    private async processAudioChunk(
        body: TranscribeChunkRequest,
        audioData: string,
        mimeType: string,
        canvasId: string,
        actualMentorIdx: number,
        actualMenteeIdx: number,
        usePynoteDiarization: boolean,
        startTime: number,
    ): Promise<STTWithContextResponse> {
        const audioBuffer = Buffer.from(audioData, 'base64');

        // 🔧 수정: 기존 세션 키 찾기 우선
        let sessionKey = this.sessionService.findActiveSessionKey(canvasId);
        let segmentIndex = 1;

        if (!sessionKey) {
            // 새로운 세션인 경우에만 새 인덱스 생성
            segmentIndex = this.getNextSegmentIndex(canvasId);
            sessionKey = this.generateSessionKey(canvasId);
            this.logger.log(`새 세션 시작 - canvasId: ${canvasId}, segmentIndex: ${segmentIndex}`);
        } else {
            // 기존 세션 사용
            this.logger.log(`기존 세션 사용 - canvasId: ${canvasId}, sessionKey: ${sessionKey}`);
        }

        // 캐시에서 기존 데이터 가져오기 또는 새로 생성
        let cached = this.sessionService.getCached(sessionKey);
        if (!cached) {
            // 새로운 세션 생성
            cached = {
                mentorIdx: actualMentorIdx,
                menteeIdx: actualMenteeIdx,
                chunks: [],
                segmentIndex,
                lastActivity: Date.now(),
                sessionStartTime: Date.now(),
            };
        } else if (body.isNewRecordingSession) {
            // 기존 세션에 새 세그먼트 추가
            cached.segmentIndex += 1;
            cached.lastActivity = Date.now();
            this.logger.log(
                `새 세그먼트 시작 - canvasId: ${canvasId}, segmentIndex: ${cached.segmentIndex}`,
            );
        } else {
            // 기존 세션 계속
            cached.lastActivity = Date.now();
        }

        // WAV 파일의 정확한 총 길이 추출
        const exactWavDuration = await this.audioDurationService.getExactDuration(
            audioBuffer,
            mimeType,
        );

        // 세션 시작 오프셋 계산
        let sessionStartOffset = 0;
        for (const chunk of cached.chunks) {
            if (chunk.duration && chunk.duration > 0) {
                sessionStartOffset += chunk.duration;
            }
        }

        this.logger.log(
            `시간 매핑 - WAV 길이: ${exactWavDuration.toFixed(3)}초, 오프셋: ${sessionStartOffset.toFixed(3)}초`,
        );

        // GCS 업로드
        const gcsKey = this.gcsService.generateGcsKey(
            `voice_chunk_${cached.segmentIndex}_${body.chunkIndex}.wav`,
            canvasId,
            actualMentorIdx,
            actualMenteeIdx,
        );

        const gcsResult = await this.gcsService.uploadChunk(audioBuffer, gcsKey, mimeType);

        if (!gcsResult?.success) {
            throw new Error('오디오 업로드 실패');
        }

        // STT + 화자 분리 처리
        const sttResult: STTResult = await this.sttService.transcribeAudioFromGcs(
            gcsResult.url as string,
            mimeType,
            sessionStartOffset,
            usePynoteDiarization,
            canvasId,
            actualMentorIdx,
            actualMenteeIdx,
        );

        const gcsUrl = gcsResult.url as string;
        this.logger.log(`GCS 업로드 완료: ${gcsUrl}`);

        // 화자 데이터 처리
        let mappedSpeakers = sttResult.speakers || [];
        if (usePynoteDiarization) {
            this.logger.log(`pyannote 시간 사용: ${mappedSpeakers.length}개 세그먼트`);
        } else {
            // Google STT만 사용할 때 정규화 적용
            if (exactWavDuration > 0 && mappedSpeakers.length > 0) {
                const sttDuration = Math.max(...mappedSpeakers.map((speaker) => speaker.endTime));
                mappedSpeakers = this.audioDurationService.mapSTTTimingsToFullDuration(
                    mappedSpeakers,
                    sttDuration,
                    exactWavDuration,
                    sessionStartOffset,
                );
            }
        }

        // 캐시에 저장
        cached.chunks.push({
            audioUrl: gcsResult.url || '',
            speakers: mappedSpeakers.map((speaker) => ({
                ...speaker,
                text_content: speaker.text_Content,
            })),
            duration: exactWavDuration,
        });
        this.sessionService.addToCache(sessionKey, cached);

        return {
            success: true,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime,
            sttSessionIdx: 0, // 임시 값
            contextText: '',
            audioUrl: gcsUrl,
            segmentIndex: cached.segmentIndex,
            speakers: mappedSpeakers.map((speaker) => ({
                ...speaker,
                text_content: speaker.text_Content,
            })),
        };
    }

    // 오디오 청크 병합
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
            const mergedBuffer = AudioProcessorUtil.mergeAudioBuffers(buffers);

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

    // 최종 청크 처리 함수
    private async handleFinalChunk(
        canvasId: string,
        mentorIdx: number,
        menteeIdx: number,
        startTime: number,
    ): Promise<STTWithContextResponse> {
        try {
            this.logger.log(`최종 청크 처리 시작 - canvasId: ${canvasId}`);

            // 🔧 수정: 더 강력한 캐시 대기 로직
            let sessionKeys = this.sessionService.findAllActiveSessionKeys(canvasId);
            this.logger.log(`활성 세션 키 발견: ${sessionKeys.length}개`);

            // 캐시가 없으면 더 긴 대기 후 재시도
            if (sessionKeys.length === 0) {
                this.logger.log('캐시 데이터 없음, 대기 중...');

                // 최대 10초간 대기 (0.2초 간격으로 50번)
                for (let i = 0; i < 50; i++) {
                    await new Promise((resolve) => setTimeout(resolve, 200));

                    sessionKeys = this.sessionService.findAllActiveSessionKeys(canvasId);
                    if (sessionKeys.length > 0) {
                        this.logger.log(`대기 후 활성 세션 발견: ${sessionKeys.length}개`);
                        break;
                    }

                    // 2초마다 진행 상황 로그
                    if (i % 10 === 9) {
                        this.logger.log(`대기 중... ${(i + 1) * 0.2}초 경과`);
                    }
                }
            }

            // 여전히 캐시가 없으면
            if (sessionKeys.length === 0) {
                this.logger.warn(`캐시 데이터 없음 - canvasId: ${canvasId}`);

                // 🔧 수정: 캐시가 없어도 성공 응답 반환 (에러 방지)
                return {
                    success: true,
                    timestamp: new Date().toISOString(),
                    processingTime: Date.now() - startTime,
                    sttSessionIdx: 0,
                    contextText: '',
                    audioUrl: '',
                    segmentIndex: 0,
                    speakers: [],
                };
            }

            this.logger.log(`캐시 데이터 확인: ${sessionKeys.length}개 세션 발견`);

            // 모든 청크를 하나의 오디오로 합치기
            const mergedAudioUrl = await this.mergeAudioChunks(
                sessionKeys.flatMap((key) => {
                    const cached = this.sessionService.getCached(key);
                    return cached?.chunks || [];
                }),
            );

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
            for (const sessionKey of sessionKeys) {
                const cached = this.sessionService.getCached(sessionKey);
                if (cached && cached.chunks.length > 0) {
                    for (const chunk of cached.chunks) {
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
            };
        } catch (error) {
            this.logger.error('최종 청크 처리 실패:', error);
            throw new InternalServerErrorException(
                `최종 청크 처리 실패: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    @Post('transcribe-base64')
    @ApiOperation({ summary: 'Base64 오디오 변환' })
    async transcribeBase64(@Body() body: TranscribeBase64RequestDto): Promise<STTResponseDto> {
        const { audioData, mimeType = 'audio/wav' } = body;
        if (!audioData) throw new BadRequestException('오디오 데이터가 없습니다.');
        if (!this.utilService.isValidBase64(audioData))
            throw new BadRequestException('유효하지 않은 Base64 데이터입니다.');

        this.logger.log(`Base64 음성 데이터 수신: ${mimeType}, 길이: ${audioData.length} bytes`);

        try {
            const startTime = Date.now();

            // 🆕 Base64 duration 계산 추가
            const audioBuffer = Buffer.from(audioData, 'base64');
            let base64Duration = 0;
            try {
                base64Duration = await AudioProcessorUtil.getAudioDuration(audioBuffer, mimeType);
                this.logger.log(`Base64 duration: ${base64Duration.toFixed(2)}초`);
            } catch (durationError) {
                this.logger.warn(`Base64 duration 계산 실패: ${durationError}`);
            }

            const result: STTResult = await this.sttService.transcribeAudioBuffer(
                Buffer.from(audioData, 'base64'),
                mimeType,
                0, // sessionStartOffset
                undefined, // gcsUrl
                false, // usePynoteDiarization
            );

            if (base64Duration > 0 && result.speakers) {
                // 수정: audioDurationService 사용
                const sttDuration = Math.max(...result.speakers.map((s) => s.endTime));
                result.speakers = this.audioDurationService.mapSTTTimingsToFullDuration(
                    result.speakers,
                    sttDuration,
                    base64Duration,
                    0, // sessionStartOffset
                );

                this.logger.log(
                    `Base64 STT 시간 정규화 완료: duration ${base64Duration.toFixed(2)}초`,
                );
            }

            const processingTime = Date.now() - startTime;

            if (!this.logFlags.completionLogged && result.confidence > 0.8) {
                this.logger.log(`STT 변환 완료 (신뢰도: ${(result.confidence * 100).toFixed(1)}%)`);
                this.logFlags.completionLogged = true;
            }
            return {
                success: true,
                timestamp: new Date().toISOString(),
                processingTime,
                result: result as STTResultDto,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`STT 변환 실패: ${message}`);
            throw new InternalServerErrorException(`STT 변환 실패: ${message}`);
        }
    }

    // ... existing code ...
    @Post('transcribe-file')
    @UseInterceptors(
        FileInterceptor('file', {
            limits: { fileSize: 10 * 1024 * 1024 }, // 10MB 제한
        }),
    )
    @ApiOperation({ summary: '파일 업로드 변환' })
    async transcribeFile(@UploadedFile() file: Express.Multer.File) {
        if (!file) throw new BadRequestException('파일이 없습니다.');

        try {
            const start = Date.now();

            // 🆕 파일 duration 계산 추가
            let fileDuration = 0;
            try {
                fileDuration = await AudioProcessorUtil.getAudioDuration(
                    file.buffer,
                    file.mimetype,
                );
                this.logger.log(`파일 duration: ${fileDuration.toFixed(2)}초`);
            } catch (durationError) {
                this.logger.warn(`파일 duration 계산 실패: ${durationError}`);
            }

            const result = await this.sttService.transcribeAudioBuffer(file.buffer, file.mimetype);

            // 🆕 시간 정규화 적용
            if (fileDuration > 0 && result.speakers) {
                // 수정: audioDurationService 사용
                const sttDuration = Math.max(...result.speakers.map((s) => s.endTime));
                result.speakers = this.audioDurationService.mapSTTTimingsToFullDuration(
                    result.speakers,
                    sttDuration,
                    fileDuration,
                    0, // sessionStartOffset
                );

                this.logger.log(`파일 STT 시간 정규화 완료: duration ${fileDuration.toFixed(2)}초`);
            }

            const processingTime = Date.now() - start;
            return {
                success: true,
                timestamp: new Date().toISOString(),
                processingTime,
                result,
            };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new InternalServerErrorException(`STT 변환 실패: ${msg}`);
        }
    }

    // ========================
    // 세션 관리 API
    // ========================
    @Get('session-users/:canvasId')
    @ApiOperation({ summary: '세션 사용자 조회' })
    async getSessionUsers(@Param('canvasId') canvasId: string): Promise<SessionUserResponse> {
        return this.sessionService.getSessionUsers(canvasId);
    }

    @Post('cleanup-inactive-sessions')
    @ApiOperation({ summary: '비활성 세션 정리' })
    cleanupInactiveSessions() {
        return this.sessionService.cleanupInactiveSessions();
    }

    // ========================
    // 메시지 관리 API
    // ========================
    @Get('session-messages/:canvasId')
    @ApiOperation({ summary: '세션별 채팅 메시지 목록 조회' })
    async getSessionMessages(
        @Param('canvasId') canvasId: string,
        @Query('page') page: string = '1',
        @Query('limit') limit: string = '20',
    ) {
        return this.messageService.getSessionMessages(canvasId, page, limit);
    }

    @Get('message-detail/:sessionIdx')
    @ApiOperation({ summary: '특정 세션의 상세 정보 조회' })
    async getMessageDetail(@Param('sessionIdx') sessionIdx: string) {
        return this.messageService.getMessageDetail(sessionIdx);
    }

    @Get('context/:sessionIdx')
    @ApiOperation({ summary: '컨텍스트 텍스트만 조회' })
    async getContextText(@Param('sessionIdx') sessionIdx: number) {
        return this.messageService.getContextText(sessionIdx);
    }
}
