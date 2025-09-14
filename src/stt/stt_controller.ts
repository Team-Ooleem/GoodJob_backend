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
import {
    STTResponseDto,
    SampleResponseDto,
    ConnectionTestResponseDto,
    STTResultDto,
} from './dto/transcribe-response';
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
import { SpeakerSegment } from './entities/speaker-segment';
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
            isNewRecordingSession = false,
        } = body;

        // 조건부 로깅
        if (!this.logFlags.requestLogged) {
            this.logger.log(`STT 요청 받음 - canvasIdx: ${canvasId}`);
            this.logFlags.requestLogged = true;
        }

        if (!audioData) throw new BadRequestException('오디오 데이터 없음');
        if (!this.utilService.isValidBase64(audioData))
            throw new BadRequestException('유효하지 않은 Base64');

        const startTime = Date.now();

        try {
            const audioBuffer = Buffer.from(audioData, 'base64');
            const sessionKey = body.url ? `${canvasId}_${body.url}` : canvasId;

            // 캐시에서 기존 데이터 가져오기 또는 새로 생성
            let cached = this.sessionService.getCached(sessionKey);

            // 새 녹화 세션이거나 캐시가 없는 경우
            if (isNewRecordingSession || !cached) {
                const existingSegmentIndex = cached?.segmentIndex || 0;
                cached = {
                    mentorIdx,
                    menteeIdx,
                    chunks: [],
                    segmentIndex: isNewRecordingSession
                        ? existingSegmentIndex + 1
                        : existingSegmentIndex,
                    lastActivity: Date.now(),
                    sessionStartTime: Date.now(),
                };
                this.logger.log(
                    `새 세그먼트 시작 - canvasId: ${canvasId}, segmentIndex: ${cached.segmentIndex}`,
                );
            }

            // 🎬 MP4 파일의 정확한 총 길이 추출
            const exactMP4Duration = await this.audioDurationService.getExactDuration(
                audioBuffer,
                mimeType,
            );

            // 🆕 세션 시작 오프셋 계산 (이전 청크들의 누적 시간)
            let sessionStartOffset = 0;
            for (const chunk of cached.chunks) {
                if (chunk.duration && chunk.duration > 0) {
                    sessionStartOffset += chunk.duration; // ✅ +로 수정
                }
            }

            this.logger.log(` 정확한 시간 매핑 시작:`);
            this.logger.log(`  - MP4 총 길이: ${exactMP4Duration.toFixed(3)}초`);
            this.logger.log(`  - 세션 오프셋: ${sessionStartOffset.toFixed(3)}초`);

            // 활동 시간 업데이트
            cached.lastActivity = Date.now();

            const gcsKey = this.gcsService.generateGcsKey(
                `voice_chunk_${cached.segmentIndex}_${body.chunkIndex}.mp4`,
                canvasId,
                mentorIdx,
                menteeIdx,
            );

            const gcsResult = await this.gcsService.uploadChunk(audioBuffer, gcsKey, mimeType);
            if (!gcsResult?.success) throw new Error('오디오 업로드 실패');

            const sttResult: STTResult = await this.sttService.transcribeAudioBuffer(
                audioBuffer,
                mimeType,
                sessionStartOffset, // ✅ sessionStartOffset만 전달
                gcsResult.url as string,
            );

            // 🎯 STT 시간을 전체 MP4 길이에 정확히 매핑
            let mappedSpeakers = sttResult.speakers || []; // ✅ sttResult.speakers로 수정
            if (exactMP4Duration > 0 && mappedSpeakers.length > 0) {
                const sttDuration = Math.max(...mappedSpeakers.map((speaker) => speaker.endTime));
                mappedSpeakers = this.audioDurationService.mapSTTTimingsToFullDuration(
                    mappedSpeakers,
                    sttDuration,
                    exactMP4Duration,
                    sessionStartOffset,
                );
            }

            // 캐시에 임시 저장 (duration 포함)
            cached.chunks.push({
                audioUrl: gcsResult.url || '',
                speakers: mappedSpeakers.map((speaker) => ({
                    ...speaker,
                    text_content: speaker.text_Content,
                })),
                duration: exactMP4Duration, // ✅ exactMP4Duration으로 수정
            });
            this.sessionService.addToCache(sessionKey, cached);

            // 최종 청크일 경우만 DB 저장
            let sttSessionIdx: number = 0;
            let contextText = '';

            if (isFinalChunk) {
                this.logger.log(
                    `✅ 최종 청크 처리 시작 - canvasIdx: ${canvasId}, segmentIndex: ${cached.segmentIndex}`,
                );

                // 새 세션 생성
                const insertResult = await this.databaseService.execute(
                    'INSERT INTO stt_transcriptions (canvas_id, mentor_idx, mentee_idx, audio_url) VALUES (?, ?, ?, ?)',
                    [
                        canvasId,
                        mentorIdx,
                        menteeIdx,
                        cached.chunks.map((c) => c.audioUrl).join(','),
                    ],
                );

                // Safe insertId access
                const insertId = (insertResult as { insertId?: number })?.insertId;
                if (typeof insertId === 'number') {
                    sttSessionIdx = insertId;
                } else {
                    throw new Error('데이터베이스에서 insert ID를 가져오는데 실패했습니다');
                }

                // 세그먼트 배치 저장
                const allSegments: Array<[number, number, string, number, number]> = [];

                for (const chunk of cached.chunks) {
                    const mappedSpeakers = this.utilService.mapSpeakersToUsers(
                        chunk.speakers as unknown as SpeakerSegment[],
                        mentorIdx,
                        menteeIdx,
                    );
                    for (const segment of mappedSpeakers) {
                        // startTime과 endTime 유효성 검증
                        if (
                            typeof segment.startTime === 'number' &&
                            typeof segment.endTime === 'number' &&
                            !isNaN(segment.startTime) &&
                            !isNaN(segment.endTime) &&
                            isFinite(segment.startTime) &&
                            isFinite(segment.endTime) &&
                            segment.startTime >= 0 &&
                            segment.endTime > segment.startTime
                        ) {
                            allSegments.push([
                                sttSessionIdx,
                                segment.userId === mentorIdx ? 0 : 1,
                                segment.text_Content,
                                segment.startTime,
                                segment.endTime,
                            ]);
                        } else {
                            this.logger.warn(
                                `유효하지 않은 시간 값 건너뜀 - startTime: ${segment.startTime}, endTime: ${segment.endTime}`,
                            );
                        }
                    }
                }

                // STT 결과가 없어도 세션은 저장됨 (이미 위에서 INSERT 완료)
                if (allSegments.length > 0) {
                    await this.sessionService.batchInsertSegments(allSegments);
                    this.logger.log(
                        `✅ 배치 세그먼트 저장 완료 - 총 ${allSegments.length}개 세그먼트`,
                    );
                } else {
                    this.logger.log('⚠️ STT 결과가 없어 세그먼트 저장을 건너뜁니다.');
                }

                // 컨텍스트 텍스트 추출
                const currentSegments = cached.chunks.flatMap((chunk) =>
                    chunk.speakers.map((speaker) => ({
                        speakerTag: speaker.speakerTag,
                        text_Content: speaker.text_content,
                        startTime: speaker.startTime,
                        endTime: speaker.endTime,
                    })),
                );

                contextText = this.utilService.extractContextText(currentSegments);

                // 캐시 제거
                this.sessionService.deleteFromCache(sessionKey);
            }

            return {
                success: true,
                timestamp: new Date().toISOString(),
                processingTime: Date.now() - startTime,
                sttSessionIdx: sttSessionIdx,
                contextText,
                audioUrl: gcsResult.url || '',
                segmentIndex: cached.segmentIndex,
                speakers: mappedSpeakers.map((segment) => ({
                    speakerTag: segment.speakerTag,
                    text_content: segment.text_Content,
                    startTime: segment.startTime,
                    endTime: segment.endTime,
                })),
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`STT 실패: ${errorMessage}`);
            throw new InternalServerErrorException('STT 처리 실패');
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

            const result = await this.sttService.transcribeBase64Audio(audioData, mimeType);

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

    @Get('test')
    @ApiOperation({ summary: 'STT API 연결 테스트' })
    async testConnection(): Promise<ConnectionTestResponseDto> {
        this.logger.log('STT API 연결 상태 확인 요청');
        const result = await this.sttService.testConnection();
        this.logger.log(`STT API 상태: ${result.status} - ${result.message}`);
        return result;
    }

    @Get('sample')
    @ApiOperation({ summary: '샘플 STT 결과' })
    getSample(): SampleResponseDto {
        const sample = this.sttService.createSampleResult();
        this.logger.log(
            `샘플 STT 결과 테스트: ${sample.transcript} (신뢰도: ${(sample.confidence * 100).toFixed(1)}%)`,
        );
        sample.speakers?.forEach((wordSegment, i) =>
            this.logger.log(
                `단어 ${i + 1}: "${wordSegment.text_Content}" (${wordSegment.startTime}s - ${wordSegment.endTime}s)`,
            ),
        );
        return { success: true, message: '샘플 STT 결과', result: sample as STTResultDto };
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
