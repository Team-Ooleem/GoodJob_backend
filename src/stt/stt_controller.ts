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
import { AudioProcessorUtil } from './utils/audio-processer'; // 🆕 추가
import { DatabaseQueryResult } from './entities/transcription';
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
            mimeType = 'audio/mp4',
            canvasId,
            mentorIdx,
            menteeIdx,
            isFinalChunk = false,
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            isNewRecordingSession = false,
            usePynoteDiarization = true,
        } = body;

        const participants = (await this.databaseService.execute(
            `
            SELECT 
                cp.user_id,
                mp.mentor_idx,
                mp.is_approved
            FROM canvas_participant cp
            LEFT JOIN mentor_profiles mp ON cp.user_id = mp.user_idx
            WHERE cp.canvas_id = ?
        `,
            [canvasId],
        )) as Array<{ user_id: number; mentor_idx: number | null; is_approved: number | null }>;

        const mentorUser = participants.find((p) => p.mentor_idx && p.is_approved === 1) || null;
        const menteeUser = participants.find((p) => !p.mentor_idx || p.is_approved !== 1) || null;

        const actualMentorIdx = mentorUser?.user_id || mentorIdx;
        const actualMenteeIdx = menteeUser?.user_id || menteeIdx;

        if (!this.logFlags.requestLogged) {
            this.logger.log(`STT 요청 받음 - canvasIdx: ${canvasId}`);
            this.logFlags.requestLogged = true;
        }

        // 🆕 최종 청크가 아닌 경우에만 오디오 데이터 검증
        if (!isFinalChunk && !audioData) {
            throw new BadRequestException('오디오 데이터 없음');
        }
        if (!isFinalChunk && !this.utilService.isValidBase64(audioData)) {
            throw new BadRequestException('유효하지 않은 Base64');
        }

        const startTime = Date.now();

        try {
            // 🆕 최종 청크가 아닌 경우에만 오디오 처리
            if (!isFinalChunk) {
                return await this.processAudioChunk(
                    body,
                    audioData,
                    mimeType,
                    canvasId,
                    actualMentorIdx,
                    actualMenteeIdx,
                    usePynoteDiarization,
                    startTime,
                );
            } else {
                // �� 최종 청크 처리 (이중처리 방지)
                return await this.handleFinalChunk(
                    canvasId,
                    actualMentorIdx,
                    actualMenteeIdx,
                    startTime,
                );
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`STT 실패: ${errorMessage}`);
            throw new InternalServerErrorException('STT 처리 실패');
        }
    }

    // �� 오디오 청크 처리 함수 (기존 로직 분리)
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
        const sessionKey = canvasId;

        // 캐시에서 기존 데이터 가져오기 또는 새로 생성
        let cached = this.sessionService.getCached(sessionKey);

        if (body.isNewRecordingSession || !cached) {
            const existingSegmentIndex = cached?.segmentIndex || 0;
            cached = {
                mentorIdx: actualMentorIdx,
                menteeIdx: actualMenteeIdx,
                chunks: [],
                segmentIndex: body.isNewRecordingSession
                    ? existingSegmentIndex + 1 // ✅ 새 세션일 때 인덱스 증가
                    : existingSegmentIndex,
                lastActivity: Date.now(),
                sessionStartTime: Date.now(),
            };
            this.logger.log(
                `새 세그먼트 시작 - canvasId: ${canvasId}, segmentIndex: ${cached.segmentIndex}`,
            );
        }
        // MP4 파일의 정확한 총 길이 추출
        const exactMP4Duration = await this.audioDurationService.getExactDuration(
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

        this.logger.log(`정확한 시간 매핑 시작:`);
        this.logger.log(`  - MP4 총 길이: ${exactMP4Duration.toFixed(3)}초`);
        this.logger.log(`  - 세션 오프셋: ${sessionStartOffset.toFixed(3)}초`);

        // 활동 시간 업데이트
        cached.lastActivity = Date.now();

        // GCS 업로드
        const gcsKey = this.gcsService.generateGcsKey(
            `voice_chunk_${cached.segmentIndex}_${body.chunkIndex}.wav`, // .mp4 → .wav
            canvasId,
            actualMentorIdx,
            actualMenteeIdx,
        );

        const gcsResult = await this.gcsService.uploadChunk(audioBuffer, gcsKey, mimeType);
        if (!gcsResult?.success) throw new Error('오디오 업로드 실패');

        // STT + pynote 화자 분리 처리
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
        this.logger.log(`✅ GCS 업로드 완료: ${gcsUrl}`);

        let mappedSpeakers = sttResult.speakers || [];
        if (usePynoteDiarization) {
            // pyannote 시간은 이미 정확하므로 그대로 사용
            this.logger.log(`✅ pyannote 시간 사용: ${mappedSpeakers.length}개 세그먼트`);
        } else {
            // 기존 Google STT만 사용할 때만 정규화 적용
            if (exactMP4Duration > 0 && mappedSpeakers.length > 0) {
                const sttDuration = Math.max(...mappedSpeakers.map((speaker) => speaker.endTime));
                mappedSpeakers = this.audioDurationService.mapSTTTimingsToFullDuration(
                    mappedSpeakers,
                    sttDuration,
                    exactMP4Duration,
                    sessionStartOffset,
                );
            }
        }

        // 캐시에 임시 저장
        cached.chunks.push({
            audioUrl: gcsResult.url || '',
            speakers: mappedSpeakers.map((speaker) => ({
                ...speaker,
                text_content: speaker.text_Content,
            })),
            duration: exactMP4Duration,
        });
        this.sessionService.addToCache(sessionKey, cached);

        return {
            success: true,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime,
            sttSessionIdx: 0, // 중간 청크는 0
            contextText: '',
            audioUrl: gcsResult.url || '',
            segmentIndex: cached.segmentIndex,
            speakers: mappedSpeakers.map((segment) => ({
                speakerTag: segment.speakerTag,
                text_content: segment.text_Content,
                startTime: segment.startTime,
                endTime: segment.endTime,
            })),
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
            this.logger.log(` ${chunks.length}개 청크 합치기 시작`);

            // 방법 1: GCS에서 오디오 파일들을 다운로드하여 합치기
            const audioBuffers: Buffer[] = [];

            for (const chunk of chunks) {
                if (chunk.audioUrl) {
                    try {
                        // GCS에서 파일 다운로드 (실제 구현 필요)
                        const response = await fetch(chunk.audioUrl);
                        if (response.ok) {
                            const buffer = Buffer.from(await response.arrayBuffer());
                            audioBuffers.push(buffer);
                        } else {
                            this.logger.warn(
                                `청크 다운로드 실패: ${chunk.audioUrl} - HTTP ${response.status}`,
                            );
                        }
                    } catch (error) {
                        this.logger.warn(`청크 다운로드 실패: ${chunk.audioUrl}`, error);
                        // 실패한 청크는 건너뛰고 계속 진행
                    }
                }
            }

            // 오디오 파일들 합치기 (ffmpeg 등 사용)
            let mergedBuffer: Buffer;
            try {
                const result = AudioProcessorUtil.mergeAudioBuffers(audioBuffers);
                if (result && Buffer.isBuffer(result)) {
                    mergedBuffer = result;
                } else {
                    throw new Error('잘못된 합쳐진 버퍼');
                }
            } catch (error) {
                this.logger.error('오디오 합치기 실패:', error);
                // fallback: 첫 번째 청크 URL 반환
                return chunks[0]?.audioUrl || '';
            }

            // 311라인 수정 - merged_session 파일명
            const mergedGcsKey = this.gcsService.generateGcsKey(
                `merged_session_${Date.now()}.wav`, // .mp4 → .wav
                'merged',
                undefined,
                undefined,
                undefined,
            );

            const uploadResult = await this.gcsService.uploadChunk(
                mergedBuffer,
                mergedGcsKey,
                'audio/mp4',
            );

            this.logger.log(`✅ 청크 합치기 완료: ${uploadResult.url}`);
            return uploadResult.url as string;
        } catch (error) {
            this.logger.error('오디오 청크 합치기 실패:', error);
            // fallback: 첫 번째 청크 URL 반환
            return chunks[0]?.audioUrl || '';
        }
    }

    // 🆕 최종 청크 처리 함수 (이중처리 방지) - any 타입 제거
    private async handleFinalChunk(
        canvasId: string,
        mentorIdx: number,
        menteeIdx: number,
        startTime: number,
    ): Promise<STTWithContextResponse> {
        try {
            this.logger.log(`✅ 최종 청크 처리 시작 - canvasIdx: ${canvasId}`);

            // 1. 캐시에서 모든 청크 데이터 가져오기 (여러 키 시도)
            let cached = this.sessionService.getCached(canvasId);
            let sessionKey = canvasId;

            if (!cached || cached.chunks.length === 0) {
                // 다른 가능한 세션 키들을 직접 시도
                const possibleKeys = [canvasId, `${canvasId}_undefined`, `${canvasId}_null`];

                for (const key of possibleKeys) {
                    const testCached = this.sessionService.getCached(key);
                    if (testCached && testCached.chunks.length > 0) {
                        cached = testCached;
                        sessionKey = key;
                        this.logger.log(`대체 세션 키 사용: ${key}`);
                        break;
                    }
                }
            }

            if (!cached || cached.chunks.length === 0) {
                this.logger.error(
                    `캐시 데이터 없음 - canvasId: ${canvasId}, sessionKey: ${sessionKey}`,
                );
                throw new Error('캐시된 청크 데이터 없음');
            }

            this.logger.log(`캐시 데이터 확인: ${cached.chunks.length}개 청크 발견`);

            // 2. 모든 청크를 하나의 오디오로 합치기
            const mergedAudioUrl = await this.mergeAudioChunks(cached.chunks);

            // 3. 최종 세션 생성 (통합 오디오 URL 포함)
            const insertResult = await this.databaseService.execute(
                'INSERT INTO stt_transcriptions (canvas_id, mentor_idx, mentee_idx, audio_url) VALUES (?, ?, ?, ?)',
                [canvasId, mentorIdx, menteeIdx, mergedAudioUrl], // ✅ 통합 오디오 URL
            );

            const finalSessionIdx = (insertResult as DatabaseQueryResult)?.insertId;

            if (!finalSessionIdx) {
                throw new Error('최종 세션 생성 실패');
            }

            // 4. 모든 세그먼트를 한 번에 저장
            const allSegments: Array<[number, number, string, number, number]> = [];

            for (const chunk of cached.chunks) {
                for (const speaker of chunk.speakers) {
                    if (speaker.startTime >= 0 && speaker.endTime > speaker.startTime) {
                        allSegments.push([
                            finalSessionIdx, // 최종 세션 ID
                            speaker.speakerTag, // 0=멘토, 1=멘티 (pynote에서 고정된 값)
                            speaker.text_content,
                            speaker.startTime,
                            speaker.endTime,
                        ]);
                    }
                }
            }

            // 5. 배치로 모든 세그먼트 저장
            if (allSegments.length > 0) {
                await this.sessionService.batchInsertSegments(allSegments);
            }

            // 6. 컨텍스트 텍스트 추출 (기존 함수 활용)
            const contextText = this.utilService.extractContextText(
                allSegments.map(([, speakerTag, text, startTime, endTime]) => ({
                    speakerTag,
                    text_content: text,
                    text: text,
                    startTime,
                    endTime,
                })),
            );

            // 7. 캐시 정리
            this.sessionService.deleteFromCache(sessionKey);

            this.logger.log(
                `✅ 최종 세션 생성 완료 - sessionIdx: ${finalSessionIdx}, 오디오: ${mergedAudioUrl}`,
            );

            return {
                success: true,
                timestamp: new Date().toISOString(),
                processingTime: Date.now() - startTime,
                sttSessionIdx: finalSessionIdx,
                contextText,
                audioUrl: mergedAudioUrl, // ✅ 통합 오디오 URL 반환
                segmentIndex: 0,
                speakers: [],
            };
        } catch (error) {
            this.logger.error('최종 청크 처리 실패:', error);
            throw new InternalServerErrorException('최종 청크 처리 실패');
        }
    }

    @Post('transcribe-base64')
    @ApiOperation({ summary: 'Base64 오디오 변환' })
    async transcribeBase64(@Body() body: TranscribeBase64RequestDto): Promise<STTResponseDto> {
        const { audioData, mimeType = 'audio/mp4' } = body;
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

            // 🆕 시간 정규화 적용
            if (base64Duration > 0 && result.speakers) {
                // 기존: result.speakers = this.sttService.normalizeTimings(result.speakers, base64Duration);

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
