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

import { STTService } from './stt_service';
import { GcsService } from '../lib/gcs';
import { DatabaseService } from '../database/database.service';
import { FileInterceptor } from '@nestjs/platform-express';

interface TranscribeChunkRequest {
    audioData: string;
    mimeType?: string;
    canvasId: string;
    mentorIdx: number;
    menteeIdx: number;
    duration?: number;
    chunkIndex: number;
    totalChunks: number;
    isFinalChunk?: boolean;
    isNewRecordingSession?: boolean; // 새 녹화 세션 여부
    url?: string;
}

interface STTWithContextResponse {
    success: boolean;
    timestamp: string;
    processingTime: number;
    sttSessionIdx: number;
    contextText: string;
    audioUrl: string;
    speakers: Array<{
        speakerTag: number;
        textContent: string;
        startTime: number;
        endTime: number;
    }>;
    segmentIndex?: number; // 현재 세그먼트 인덱스
}

interface SessionUserResponse {
    success: boolean;
    canvasId: string;
    mentor: { idx: number; name: string };
    mentee: { idx: number; name: string };
}

interface ChatMessage {
    messageId: number;
    contextText: string;
    audioUrl: string;
    timestamp: string;
    mentor_idx: number;
    mentee_idx: number;
    speakerInfo: { mentor: string; mentee: string };
    canvasId: string;
    segmentIndex: number; // 세그먼트 인덱스 추가
    segments?: Array<{
        speakerTag: number;
        textContent: string;
        startTime: number;
        endTime: number;
    }>;
}

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
    // key: canvasIdx, value: { mentorIdx, menteeIdx, chunks: { audioUrl, speakers }[], segmentIndex, lastActivity }
    // ========================
    private chunkCache: Map<
        string,
        {
            mentorIdx: number;
            menteeIdx: number;
            chunks: Array<{ audioUrl: string; speakers: any[] }>;
            segmentIndex: number; // 현재 세그먼트 인덱스
            lastActivity: number; // 마지막 활동 시간
            sessionStartTime: number; // 세션 시작 시간
        }
    > = new Map();

    // 자동 청크 증가 설정
    private readonly MAX_CHUNK_DURATION = 30000; // 30초 (밀리초)
    private readonly INACTIVITY_THRESHOLD = 5000; // 5초 (밀리초)

    // ========================
    // 세션 사용자 조회
    // ========================
    @Get('session-users/:canvasId')
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
                // cached.sessionStartTime = Date.now(); // 이 줄을 제거
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

                const insertResult: any = await this.databaseService.query(
                    'INSERT INTO stt_transcriptions (canvas_id, mentor_idx, mentee_idx, audio_url) VALUES (?, ?, ?, ?)',
                    [
                        canvasId,
                        mentorIdx,
                        menteeIdx,
                        cached.chunks.map((c) => c.audioUrl).join(','),
                    ],
                );

                sttSessionIdx = insertResult.insertId as number;
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

                //

                // DB에서 조회한 세그먼트 대신 현재 STT 결과 사용
                const currentSegments = cached.chunks.flatMap((chunk) =>
                    chunk.speakers.map((speaker) => ({
                        speakerTag: speaker.speakerTag as number,
                        textContent: speaker.text_Content as string,
                        startTime: speaker.startTime as number,
                        endTime: speaker.endTime as number,
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
    async transcribeFile(@UploadedFile() file: Express.Multer.File) {
        if (!file) throw new BadRequestException('파일이 없습니다.');
        // (선택) 파일 검증 재활용
        // this.validateAudioFile(file);

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
            const rows: any[] = await this.databaseService.query(
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

            console.log(' 쿼리 결과:', rows); // ← 25번째 줄에 추가
            console.log('🔍 쿼리 결과 개수:', rows.length); // ← 26번째

            // 전체 개수 조회 (페이지네이션을 위한 총 개수)
            const countResult: any = await this.databaseService.query(
                `SELECT COUNT(DISTINCT st.stt_session_idx) as total
                 FROM stt_transcriptions st
                 WHERE st.canvas_id = ?`,
                [canvasId],
            );
            const totalCount = Array.isArray(countResult)
                ? (countResult[0].total as number)
                : (countResult.total as number);

            // 세션별 그룹핑
            const grouped: { [sessionId: number]: ChatMessage & { segments: any[] } } = {};

            for (const row of rows) {
                if (!grouped[row.stt_session_idx]) {
                    grouped[row.stt_session_idx] = {
                        messageId: row.stt_session_idx as number,
                        contextText: '',
                        audioUrl: row.audio_url as string,
                        timestamp: row.created_at as string,
                        mentor_idx: row.mentor_idx as number,
                        mentee_idx: row.mentee_idx as number,
                        segmentIndex: 0,
                        speakerInfo: {
                            mentor: row.mentor_name as string,
                            mentee: row.mentee_name as string,
                        },
                        canvasId: canvasId,
                        segments: [],
                    };
                }

                if (row.speaker_idx !== null) {
                    grouped[row.stt_session_idx].segments.push({
                        speakerTag: row.speaker_idx as number,
                        textContent: row.text_content as string,
                        startTime: row.start_time as number,
                        endTime: row.end_time as number,
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

    // ========================
    // 비활성 세션 정리 (주기적 호출)
    // ========================
    @Post('cleanup-inactive-sessions')
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
            textContent: string;
            startTime: number;
            endTime: number;
        }>,
    ): string {
        if (!speakers?.length) return '';
        return speakers
            .sort((a, b) => a.startTime - b.startTime)
            .map((seg) => seg.textContent?.trim() || '')
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
        speakers:
            | Array<{
                  speakerTag: number;
                  text_Content: string;
                  startTime: number;
                  endTime: number;
              }>
            | undefined,
        mentorIdx: number,
        menteeIdx: number,
    ): Array<{ userId: number; text_Content: string; startTime: number; endTime: number }> {
        if (!speakers) return [];
        return speakers.map((seg) => ({
            userId: seg.speakerTag === 1 ? mentorIdx : menteeIdx,
            text_Content: seg.text_Content,
            startTime: seg.startTime,
            endTime: seg.endTime,
        }));
    }
}
