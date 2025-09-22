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
import { SessionTimerService } from './services/session-timer.service';
import { TranscribeContextUseCase } from './services/transcribe-context.use-case';

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
        private readonly sessionTimerService: SessionTimerService,
        private readonly transcribeUseCase: TranscribeContextUseCase,
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
        const startTime = Date.now();

        try {
            this.logger.log(
                `STT 요청 받음 - canvasId: ${body.canvasId}, isFinalChunk: ${body.isFinalChunk}`,
            );

            // ✅ 모든 비즈니스 로직을 유스케이스로 위임
            const result = await this.transcribeUseCase.execute(body);

            this.logger.log(`STT 처리 완료 - 처리시간: ${Date.now() - startTime}ms`);
            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`STT 실패: ${errorMessage}`);
            throw new InternalServerErrorException(`STT 처리 실패: ${errorMessage}`);
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
