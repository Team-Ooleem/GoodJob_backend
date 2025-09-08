/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    BadRequestException,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';

import { STTService } from './stt_service';
import { GcsService } from '../lib/gcs';
import { DatabaseService } from '../database/database.service';

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
                 WHERE st.canvas_idx = ?
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

            // 캐시에서 기존 데이터 가져오기 또는 새로 생성
            let cached = this.chunkCache.get(canvasId);

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
                // 자동으로 새 청크 생성
                cached.sessionStartTime = Date.now();
                this.logger.log(
                    `🔄 자동 청크 증가 - canvasId: ${canvasId}, chunkIndex: ${body.chunkIndex}`,
                );
            }

            // 활동 시간 업데이트
            cached.lastActivity = Date.now();

            //이전 청크시간 계산
            const previousChunksDuration = cached.chunks.reduce(
                (total: number, chunk: { speakers: { endTime: number }[] }) => {
                    const chunkDuration = chunk.speakers.reduce(
                        (max: number, speaker: { endTime: number }) =>
                            Math.max(max, speaker.endTime),
                        0,
                    );
                    return total + chunkDuration;
                },
                0,
            );

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
                previousChunksDuration,
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
            this.chunkCache.set(canvasId, cached);

            // ========================
            // 최종 청크일 경우만 DB 저장
            // ========================
            let sttSessionIdx: number = 0;
            let contextText = '';

            if (isFinalChunk) {
                this.logger.log(
                    `✅ 최종 청크 처리 시작 - canvasIdx: ${canvasId}, segmentIndex: ${cached.segmentIndex}`,
                );

                // 세션 존재 확인 / 생성
                const sessionRecord: any = await this.databaseService.query(
                    'SELECT stt_session_idx FROM stt_transcriptions WHERE canvas_idx = ? AND segment_index = ?',
                    [canvasId, cached.segmentIndex],
                );

                if (!sessionRecord.length) {
                    this.logger.log(
                        `🆕 신규 세션 생성 - canvasId: ${canvasId}, segmentIndex: ${cached.segmentIndex}`,
                    );
                    // 신규 세션 생성
                    const insertResult: any = await this.databaseService.query(
                        'INSERT INTO stt_transcriptions (canvas_idx, mentor_idx, mentee_idx, audio_url, segment_index) VALUES (?, ?, ?, ?, ?)',
                        [
                            canvasId,
                            mentorIdx,
                            menteeIdx,
                            cached.chunks.map((c) => c.audioUrl).join(','),
                            cached.segmentIndex,
                        ],
                    );
                    sttSessionIdx = insertResult.insertId as number;
                    this.logger.log(`✅ 세션 생성 완료 - sttSessionIdx: ${sttSessionIdx}`);
                } else {
                    sttSessionIdx = sessionRecord[0].stt_session_idx as number;
                    this.logger.log(`🔄 기존 세션 업데이트 - sttSessionIdx: ${sttSessionIdx}`);
                    await this.databaseService.query(
                        'UPDATE stt_transcriptions SET audio_url = ? WHERE stt_session_idx = ?',
                        [cached.chunks.map((c) => c.audioUrl).join(','), sttSessionIdx],
                    );
                }

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
                        speakerTag: speaker.speakerTag as number,
                        textContent: speaker.text_Content as string,
                        startTime: speaker.startTime as number,
                        endTime: speaker.endTime as number,
                    })),
                );

                contextText = this.extractContextText(currentSegments);

                // 캐시 제거
                this.chunkCache.delete(canvasId);
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

    // ========================
    // 세션 메시지 조회
    // ========================
    @Get('session-messages/:canvasId')
    async getSessionMessages(@Param('canvasId') canvasId: string) {
        try {
            // ✅ 1번의 JOIN 쿼리로 모든 데이터 조회 (segment_index 추가)
            const rows: any[] = await this.databaseService.query(
                `SELECT st.stt_session_idx, st.audio_url, st.created_at, st.segment_index,
                    st.mentor_idx, st.mentee_idx,
                    mentor.name as mentor_name, mentee.name as mentee_name,
                    seg.speaker_idx, seg.text_content, seg.start_time, seg.end_time
             FROM stt_transcriptions st
             JOIN users mentor ON st.mentor_idx = mentor.idx
             JOIN users mentee ON st.mentee_idx = mentee.idx
             LEFT JOIN stt_speaker_segments seg ON st.stt_session_idx = seg.stt_session_idx
             WHERE st.canvas_idx = ?
             ORDER BY st.segment_index ASC, st.created_at DESC, seg.start_time ASC`,
                [canvasId],
            );

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
                        segmentIndex: row.segment_index as number,
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

            return { success: true, messages, totalCount: messages.length };
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

        for (const [canvasId, cached] of this.chunkCache.entries()) {
            if (now - cached.lastActivity > this.INACTIVITY_THRESHOLD) {
                this.chunkCache.delete(canvasId);
                cleanedCount++;
                this.logger.log(`�� 비활성 세션 정리 - canvasId: ${canvasId}`);
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
