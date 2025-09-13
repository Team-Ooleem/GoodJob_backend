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
    ) {}

    // ========================
    // 핵심 STT API
    // ========================
    // ... existing code ...

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
            duration,
            isFinalChunk = false,
            isNewRecordingSession = false,
        } = body;

        this.logger.log(
            `STT 요청 받음 - canvasIdx: ${canvasId}, isFinalChunk: ${isFinalChunk}, chunkIndex: ${body.chunkIndex}, isNewSession: ${isNewRecordingSession}`,
        );

        if (!audioData) throw new BadRequestException('오디오 데이터 없음');
        if (!this.utilService.isValidBase64(audioData))
            throw new BadRequestException('유효하지 않은 Base64');

        const startTime = Date.now();

        try {
            const audioBuffer = Buffer.from(audioData, 'base64');
            const sessionKey = body.url ? `${canvasId}_${body.url}` : canvasId;

            // 🆕 music-metadata로 정확한 청크 duration 계산
            let chunkDuration = 0;
            try {
                chunkDuration = await AudioProcessorUtil.getAudioDuration(audioBuffer, mimeType);
                this.logger.log(`청크 duration: ${chunkDuration.toFixed(2)}초`);
            } catch (durationError) {
                this.logger.warn(`청크 duration 계산 실패: ${durationError}`);
                chunkDuration = audioBuffer.length / 16000;
            }

            // 정확한 duration 계산
            let actualDuration = duration;
            if (!actualDuration || actualDuration <= 0) {
                actualDuration = chunkDuration;
                if (actualDuration > 0) {
                    this.logger.log(`계산된 duration: ${actualDuration.toFixed(2)}초`);
                } else {
                    this.logger.warn('Duration이 0이므로 기본값을 사용합니다.');
                    actualDuration = audioBuffer.length / 16000;
                }
            }

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

            // �� 이전 청크들의 누적 duration 계산
            let cumulativeDuration = 0;
            for (const chunk of cached.chunks) {
                if (chunk.duration && chunk.duration > 0) {
                    cumulativeDuration += chunk.duration;
                } else {
                    cumulativeDuration += 0.3; // 기본 0.3초
                }
            }

            this.logger.log(
                `누적 duration: ${cumulativeDuration.toFixed(2)}초, 현재 청크: ${chunkDuration.toFixed(2)}초`,
            );

            // 활동 시간 업데이트
            cached.lastActivity = Date.now();
            const actualRecordingTime = Date.now() - cached.sessionStartTime;

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
                actualRecordingTime + cumulativeDuration, // 🆕 누적 duration 추가
                gcsResult.url as string,
            );

            // 🔍 STT 결과 디버깅 로그 추가
            this.logger.log(
                `🔍 STT 원본 결과: transcript="${sttResult.transcript}", confidence=${sttResult.confidence}, speakers=${sttResult.speakers?.length || 0}개`,
            );
            if (sttResult.speakers && sttResult.speakers.length > 0) {
                sttResult.speakers.forEach((speaker, i) => {
                    this.logger.log(
                        `  세그먼트 ${i}: "${speaker.text_Content}" (${speaker.startTime}s-${speaker.endTime}s)`,
                    );
                });
            } else {
                this.logger.warn(
                    `❌ STT 결과에 speakers가 없습니다. transcript: "${sttResult.transcript}"`,
                );
            }

            // 🆕 개선된 시간 정규화
            let normalizedSpeakers = sttResult.speakers || [];
            if (actualDuration && actualDuration > 0) {
                normalizedSpeakers = this.sttService.normalizeTimings(
                    normalizedSpeakers,
                    actualDuration,
                );
                this.logger.log(
                    `시간 정규화 완료: ${normalizedSpeakers.length}개 세그먼트, duration: ${actualDuration.toFixed(2)}초`,
                );
            } else {
                this.logger.warn('Duration이 없어 시간 정규화를 건너뜁니다.');
            }

            // 캐시에 임시 저장 (duration 포함)
            cached.chunks.push({
                audioUrl: gcsResult.url || '',
                speakers: normalizedSpeakers.map((speaker) => ({
                    ...speaker,
                    text_content: speaker.text_Content,
                })),
                duration: chunkDuration, // 🆕 현재 청크의 duration 저장
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
                speakers: normalizedSpeakers.map((segment) => ({
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
                result.speakers = this.sttService.normalizeTimings(result.speakers, base64Duration);
                this.logger.log(
                    `Base64 STT 시간 정규화 완료: duration ${base64Duration.toFixed(2)}초`,
                );
            }

            const processingTime = Date.now() - startTime;

            this.logger.log(
                `STT 변환 완료: ${result.transcript} (신뢰도: ${(result.confidence * 100).toFixed(1)}%)`,
            );
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
                const speakersForNormalization = result.speakers.map((speaker) => ({
                    ...speaker,
                    textContent: speaker.text_Content,
                }));
                const normalized = this.sttService.normalizeTimings(
                    speakersForNormalization,
                    fileDuration,
                );
                result.speakers = normalized.map((speaker) => ({
                    ...speaker,
                    text_Content: speaker.text_Content,
                }));
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
