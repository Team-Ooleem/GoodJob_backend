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
import {
    SpeakerSegment,
    MappedSpeakerSegment,
    SessionDetailData,
    SegmentData,
} from './entities/speaker-segment';
import type {
    TranscribeChunkRequest,
    STTWithContextResponse,
    SessionUserResponse,
    ChatMessage,
    ChunkCacheData,
} from './entities/transcription';

@ApiTags('Speech-to-Text')
@Controller('stt')
export class STTController {
    private readonly logger = new Logger(STTController.name);

    constructor(
        private readonly sttService: STTService,
        private readonly gcsService: GcsService,
        private readonly databaseService: DatabaseService,
    ) {}

    // ========================
    // 메모리 캐시 (중간 청크 임시 저장)
    // ========================
    private chunkCache: Map<string, ChunkCacheData> = new Map();

    // 자동 청크 증가 설정
    private readonly MAX_CHUNK_DURATION = 30000; // 30초 (밀리초)
    private readonly INACTIVITY_THRESHOLD = 5000; // 5초 (밀리초)

    // ========================
    // 세션 사용자 조회
    // ========================
    @Get('session-users/:canvasId')
    @ApiOperation({ summary: '세션 사용자 조회' })
    async getSessionUsers(@Param('canvasId') canvasId: string): Promise<SessionUserResponse> {
        try {
            const result = await this.databaseService.query(
                `SELECT 
                    st.mentor_idx,
                    st.mentee_idx,
                    mentor.name as mentor_name,
                    mentee.name as mentee_name
                 FROM stt_transcriptions st
                 JOIN users mentor ON st.mentor_idx = mentor.idx
                 JOIN users mentee ON st.mentee_idx = mentee.idx
                 WHERE st.canvas_id = ?
                 LIMIT 1`,
                [canvasId],
            );

            if (!result.length) throw new BadRequestException('해당 캔버스 세션 없음');

            const session = result[0] as {
                mentor_idx: number;
                mentor_name: string;
                mentee_idx: number;
                mentee_name: string;
            };
            return {
                success: true,
                canvasId: canvasId,
                mentor: { idx: session.mentor_idx, name: session.mentor_name },
                mentee: { idx: session.mentee_idx, name: session.mentee_name },
            };
        } catch (error) {
            this.logger.error(`세션 사용자 조회 실패: ${error}`);
            throw new InternalServerErrorException('세션 사용자 조회 실패');
        }
    }

    // ========================
    // STT 변환 + 컨텍스트 생성 (청크 지원, DB 최종 청크에서만 저장)
    // ========================
    @Post('transcribe-with-context')
    @ApiOperation({ summary: '화자 분리 + 컨텍스트 추출 + DB 저장 (청크 지원)' })
    async transcribeWithContext(
        @Body() body: TranscribeChunkRequest,
    ): Promise<STTWithContextResponse> {
        const {
            audioData,
            mimeType = 'audio/webm',
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
        if (!this.isValidBase64(audioData)) throw new BadRequestException('유효하지 않은 Base64');

        const startTime = Date.now();

        try {
            const audioBuffer = Buffer.from(audioData, 'base64');

            const sessionKey = body.url ? `${canvasId}_${body.url}` : canvasId;
            // 캐시에서 기존 데이터 가져오기 또는 새로 생성
            let cached = this.chunkCache.get(sessionKey);

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
                    `�� 새 세그먼트 시작 - canvasId: ${canvasId}, segmentIndex: ${cached.segmentIndex}`,
                );
            }

            // 자동 청크 증가 체크
            const currentChunkDuration = Date.now() - cached.sessionStartTime;
            if (currentChunkDuration > this.MAX_CHUNK_DURATION && !isFinalChunk) {
                // 자동으로 새 청크 생성 (시간 리셋하지 않음)
                this.logger.log(
                    `🔄 자동 청크 증가 - canvasId: ${canvasId}, chunkIndex: ${body.chunkIndex}`,
                );
            }

            // 활동 시간 업데이트
            cached.lastActivity = Date.now();

            //이전 청크시간 계산
            const actualRecordingTime = Date.now() - cached.sessionStartTime;

            const gcsKey = this.gcsService.generateGcsKey(
                `voice_chunk_${cached.segmentIndex}_${body.chunkIndex}.webm`,
                canvasId,
                mentorIdx,
                menteeIdx,
            );
            const gcsResult = await this.gcsService.uploadChunk(audioBuffer, gcsKey, mimeType);
            if (!gcsResult?.success) throw new Error('오디오 업로드 실패');

            const sttResult = await this.sttService.transcribeAudioBuffer(
                audioBuffer,
                mimeType,
                actualRecordingTime,
                gcsResult?.url,
            );

            // 시간 정규화
            let normalizedSpeakers = sttResult.speakers || [];
            if (duration) {
                normalizedSpeakers = this.sttService.normalizeTimings(normalizedSpeakers, duration);
            }

            // ========================
            // 캐시에 임시 저장
            // ========================
            cached.chunks.push({ audioUrl: gcsResult.url || '', speakers: normalizedSpeakers });
            this.chunkCache.set(sessionKey, cached);

            // ========================
            // 최종 청크일 경우만 DB 저장
            // ========================
            let sttSessionIdx: number = 0;
            let contextText = '';

            if (isFinalChunk) {
                this.logger.log(
                    `✅ 최종 청크 처리 시작 - canvasIdx: ${canvasId}, segmentIndex: ${cached.segmentIndex}`,
                );

                // 매번 새로운 세션 생성 (기존 세션 업데이트 로직 제거)
                this.logger.log(
                    `�� 새 세션 생성 - canvasId: ${canvasId}, segmentIndex: ${cached.segmentIndex}, isNewSession: ${isNewRecordingSession}`,
                );

                const insertResult = await this.databaseService.query(
                    'INSERT INTO stt_transcriptions (canvas_id, mentor_idx, mentee_idx, audio_url) VALUES (?, ?, ?, ?)',
                    [
                        canvasId,
                        mentorIdx,
                        menteeIdx,
                        cached.chunks.map((c) => c.audioUrl).join(','),
                    ],
                );

                sttSessionIdx = (insertResult as { insertId: number }[])[0].insertId;

                this.logger.log(`✅ 새 세션 생성 완료 - sttSessionIdx: ${sttSessionIdx}`);

                // 세그먼트 저장
                for (const chunk of cached.chunks) {
                    const mappedSpeakers = this.mapSpeakersToUsers(
                        chunk.speakers,
                        mentorIdx,
                        menteeIdx,
                    );
                    for (const segment of mappedSpeakers) {
                        await this.databaseService.query(
                            `INSERT INTO stt_speaker_segments
                             (stt_session_idx, speaker_idx, text_content, start_time, end_time)
                             VALUES (?, ?, ?, ?, ?)`,
                            [
                                sttSessionIdx,
                                segment.userId === mentorIdx ? 0 : 1,
                                segment.text_Content,
                                segment.startTime,
                                segment.endTime,
                            ],
                        );
                    }
                }

                // DB에서 조회한 세그먼트 대신 현재 STT 결과 사용
                const currentSegments = cached.chunks.flatMap((chunk) =>
                    chunk.speakers.map((speaker) => ({
                        speakerTag: speaker.speakerTag,
                        textContent: speaker.text_Content,
                        startTime: speaker.startTime,
                        endTime: speaker.endTime,
                    })),
                );

                contextText = this.extractContextText(currentSegments);

                // 캐시 제거
                this.chunkCache.delete(sessionKey);
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
                    textContent: segment.text_Content,
                    startTime: segment.startTime,
                    endTime: segment.endTime,
                })),
            };
        } catch (error) {
            this.logger.error(`STT 실패: ${error}`);
            throw new InternalServerErrorException('STT 처리 실패');
        }
    }

    @Post('transcribe-file')
    @UseInterceptors(
        FileInterceptor('file', {
            limits: { fileSize: 10 * 1024 * 1024 }, // 10MB 제한 (필요시 조정)
        }),
    )
    @ApiOperation({ summary: '파일 업로드 변환' })
    async transcribeFile(@UploadedFile() file: Express.Multer.File) {
        if (!file) throw new BadRequestException('파일이 없습니다.');

        try {
            const start = Date.now();
            const result = await this.sttService.transcribeAudioBuffer(file.buffer, file.mimetype);
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
    // 세션 메시지 조회
    // ========================
    @Get('session-messages/:canvasId')
    @ApiOperation({ summary: '세션별 채팅 메시지 목록 조회' })
    async getSessionMessages(
        @Param('canvasId') canvasId: string,
        @Query('page') page: string = '1',
        @Query('limit') limit: string = '20',
    ) {
        try {
            const pageNum = parseInt(page, 10) || 1;
            const limitNum = parseInt(limit, 10) || 20;
            const offset = (pageNum - 1) * limitNum;

            // ✅ 1번의 JOIN 쿼리로 모든 데이터 조회 (페이지네이션 추가)
            const rows = await this.databaseService.query(
                `SELECT st.stt_session_idx, st.audio_url, st.created_at,
                st.mentor_idx, st.mentee_idx,
                mentor.name as mentor_name, mentee.name as mentee_name,
                seg.speaker_idx, seg.text_content, seg.start_time, seg.end_time
             FROM stt_transcriptions st
             JOIN users mentor ON st.mentor_idx = mentor.idx
             JOIN users mentee ON st.mentee_idx = mentee.idx
             LEFT JOIN stt_speaker_segments seg ON st.stt_session_idx = seg.stt_session_idx
             WHERE st.canvas_id = ?
             ORDER BY st.created_at DESC, seg.start_time ASC
             LIMIT ? OFFSET ?`,
                [canvasId, limitNum, offset],
            );

            console.log('🔍 쿼리 결과:', rows);
            console.log('🔍 쿼리 결과 개수:', rows.length);

            // 전체 개수 조회 (페이지네이션을 위한 총 개수)
            const countResult = await this.databaseService.query(
                `SELECT COUNT(DISTINCT st.stt_session_idx) as total
                 FROM stt_transcriptions st
                 WHERE st.canvas_id = ?`,
                [canvasId],
            );

            const totalCount: number = Array.isArray(countResult)
                ? (countResult[0] as { total: number })?.total || 0
                : (countResult as { total: number })?.total || 0;

            // 세션별 그룹핑
            const grouped: { [sessionId: number]: ChatMessage & { segments: any[] } } = {};

            for (const row of rows) {
                const sessionIdx = (row as { stt_session_idx: number }).stt_session_idx;
                if (!grouped[sessionIdx]) {
                    grouped[sessionIdx] = {
                        messageId: sessionIdx,
                        contextText: '',
                        audioUrl: (row as { audio_url: string }).audio_url,
                        timestamp: (row as { created_at: string }).created_at,
                        mentor_idx: (row as { mentor_idx: number }).mentor_idx,
                        mentee_idx: (row as { mentee_idx: number }).mentee_idx,
                        segmentIndex: 0,
                        speakerInfo: {
                            mentor: (row as { mentor_name: string }).mentor_name,
                            mentee: (row as { mentee_name: string }).mentee_name,
                        },
                        canvasId: canvasId,
                        segments: [],
                    };
                }

                if ((row as { speaker_idx: number }).speaker_idx !== null) {
                    grouped[sessionIdx].segments.push({
                        speakerTag: (row as { speaker_idx: number }).speaker_idx,
                        textContent: (row as { text_content: string }).text_content,
                        startTime: (row as { start_time: number }).start_time,
                        endTime: (row as { end_time: number }).end_time,
                    });
                }
            }

            const messages: ChatMessage[] = Object.values(grouped).map((msg) => {
                msg.contextText = this.extractContextText(msg.segments) || '음성 메시지';
                return msg;
            });

            return {
                success: true,
                messages,
                totalCount,
                page: pageNum,
                limit: limitNum,
                hasMore: offset + limitNum < totalCount,
            };
        } catch (error) {
            this.logger.error(`세션 메시지 조회 실패: ${error}`);
            throw new InternalServerErrorException('메시지 조회 실패');
        }
    }

    @Get('message-detail/:sessionIdx')
    @ApiOperation({ summary: '특정 세션의 상세 정보 조회' })
    async getMessageDetail(@Param('sessionIdx') sessionIdx: string) {
        try {
            const sessionInfo = await this.databaseService.query(
                `
                SELECT 
                    st.*,
                    mentor.name as mentor_name,
                    mentee.name as mentee_name
                FROM stt_transcriptions st
                JOIN users mentor ON st.mentor_idx = mentor.idx
                JOIN users mentee ON st.mentee_idx = mentee.idx
                WHERE st.stt_session_idx = ?
            `,
                [sessionIdx],
            );

            if (sessionInfo.length === 0) {
                throw new BadRequestException('세션을 찾을 수 없습니다.');
            }

            const segments = await this.databaseService.query(
                `
                SELECT 
                    speaker_idx,
                    text_content,
                    start_time,
                    end_time
                FROM stt_speaker_segments
                WHERE stt_session_idx = ?
                ORDER BY start_time
            `,
                [sessionIdx],
            );

            const contextText = this.extractContextText(
                segments.map((segment: SegmentData) => ({
                    speakerTag: segment.speaker_idx,
                    text: segment.text_content,
                    startTime: segment.start_time,
                    endTime: segment.end_time,
                })),
            );

            return {
                success: true,
                session: sessionInfo[0] as SessionDetailData,
                contextText,
                segments: segments.map((segment: SegmentData) => ({
                    speakerTag: segment.speaker_idx,
                    textContent: segment.text_content,
                    startTime: segment.start_time,
                    endTime: segment.end_time,
                })),
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`메시지 상세 조회 실패: ${message}`);
            throw new InternalServerErrorException(`메시지 상세 조회 실패: ${message}`);
        }
    }

    @Get('context/:sessionIdx')
    @ApiOperation({ summary: '컨텍스트 텍스트만 조회' })
    async getContextText(@Param('sessionIdx') sessionIdx: number) {
        try {
            const segments = await this.databaseService.query(
                'SELECT speaker_idx, text_content, start_time, end_time FROM stt_speaker_segments WHERE stt_session_idx = ? ORDER BY start_time',
                [sessionIdx],
            );

            const speakers = segments.map((segment: SegmentData) => ({
                speakerTag: segment.speaker_idx,
                text: segment.text_content,
                startTime: segment.start_time,
                endTime: segment.end_time,
            }));

            const contextText = this.extractContextText(speakers);
            return { contextText, speakers };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`컨텍스트 조회 실패: ${message}`);
            throw new InternalServerErrorException(`컨텍스트 조회 실패: ${message}`);
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

    @Post('transcribe-base64')
    @ApiOperation({ summary: 'Base64 오디오 변환' })
    async transcribeBase64(@Body() body: TranscribeBase64RequestDto): Promise<STTResponseDto> {
        const { audioData, mimeType = 'audio/webm' } = body;
        if (!audioData) throw new BadRequestException('오디오 데이터가 없습니다.');
        if (!this.isValidBase64(audioData))
            throw new BadRequestException('유효하지 않은 Base64 데이터입니다.');

        this.logger.log(`Base64 음성 데이터 수신: ${mimeType}, 길이: ${audioData.length} bytes`);

        try {
            const startTime = Date.now();
            const result = await this.sttService.transcribeBase64Audio(audioData, mimeType);
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
    // 비활성 세션 정리 (주기적 호출)
    // ========================
    @Post('cleanup-inactive-sessions')
    @ApiOperation({ summary: '비활성 세션 정리' })
    cleanupInactiveSessions() {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [sessionKey, cached] of this.chunkCache.entries()) {
            if (now - cached.lastActivity > this.INACTIVITY_THRESHOLD) {
                this.chunkCache.delete(sessionKey);
                cleanedCount++;

                // sessionKey에서 canvasId 추출하여 로그
                const canvasId = sessionKey.includes('_') ? sessionKey.split('_')[0] : sessionKey;
                this.logger.log(
                    `🧹 비활성 세션 정리 - sessionKey: ${sessionKey}, canvasId: ${canvasId}`,
                );
            }
        }

        return { success: true, cleanedCount };
    }

    // ========================
    // 유틸 함수
    // ========================
    private isValidBase64(str: string): boolean {
        try {
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(str) || str.length % 4 !== 0) return false;
            Buffer.from(str, 'base64');
            return true;
        } catch {
            return false;
        }
    }

    private extractContextText(
        speakers: Array<{
            speakerTag: number;
            textContent?: string;
            text?: string;
            startTime: number;
            endTime: number;
        }>,
    ): string {
        if (!speakers?.length) return '';
        return speakers
            .sort((a, b) => a.startTime - b.startTime)
            .map((seg) => (seg.textContent || seg.text || '').trim())
            .filter(
                (text) =>
                    text.length > 2 &&
                    ![
                        '아',
                        '어',
                        '음',
                        '으',
                        '그',
                        '저',
                        '이',
                        '그런데',
                        '그러면',
                        '네',
                        '예',
                        '아니요',
                    ].includes(text),
            )
            .join(' ');
    }

    private mapSpeakersToUsers(
        speakers: SpeakerSegment[] | undefined,
        mentorIdx: number,
        menteeIdx: number,
    ): MappedSpeakerSegment[] {
        if (!speakers) return [];
        return speakers.map((seg) => ({
            userId: seg.speakerTag === 1 ? mentorIdx : menteeIdx,
            text_Content: seg.text_Content,
            startTime: seg.startTime,
            endTime: seg.endTime,
        }));
    }
}
