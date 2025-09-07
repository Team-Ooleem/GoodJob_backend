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
    canvasIdx: number;
    mentorIdx: number;
    menteeIdx: number;
    duration?: number;
    chunkIndex: number;
    totalChunks: number;
    isFinalChunk?: boolean;
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
}

interface SessionUserResponse {
    success: boolean;
    canvasIdx: number;
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
    canvasIdx: number;
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
    // key: canvasIdx, value: { mentorIdx, menteeIdx, chunks: { audioUrl, speakers }[] }
    // ========================
    private chunkCache: Map<
        number,
        {
            mentorIdx: number;
            menteeIdx: number;
            chunks: Array<{ audioUrl: string; speakers: any[] }>;
        }
    > = new Map();

    // ========================
    // 세션 사용자 조회
    // ========================
    @Get('session-users/:canvasIdx')
    async getSessionUsers(@Param('canvasIdx') canvasIdx: string): Promise<SessionUserResponse> {
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
                [parseInt(canvasIdx, 10)],
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
                canvasIdx: parseInt(canvasIdx, 10),
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
            canvasIdx,
            mentorIdx,
            menteeIdx,
            duration,
            isFinalChunk = false,
        } = body;

        if (!audioData) throw new BadRequestException('오디오 데이터 없음');
        if (!this.isValidBase64(audioData)) throw new BadRequestException('유효하지 않은 Base64');

        const startTime = Date.now();

        try {
            const audioBuffer = Buffer.from(audioData, 'base64');
            const sttResult = await this.sttService.transcribeAudioBuffer(audioBuffer, mimeType);

            // 시간 정규화
            let normalizedSpeakers = sttResult.speakers || [];
            if (duration) {
                normalizedSpeakers = this.sttService.normalizeTimings(normalizedSpeakers, duration);
            }

            // GCS 업로드
            const gcsKey = this.gcsService.generateGcsKey(
                `voice_chunk_${body.chunkIndex}.webm`,
                canvasIdx,
                mentorIdx,
                menteeIdx,
            );
            const gcsResult = await this.gcsService.uploadChunk(audioBuffer, gcsKey, mimeType);
            if (!gcsResult?.success) throw new Error('오디오 업로드 실패');

            // ========================
            // 캐시에 임시 저장
            // ========================
            const cached = this.chunkCache.get(canvasIdx) || { mentorIdx, menteeIdx, chunks: [] };
            cached.chunks.push({ audioUrl: gcsResult.url || '', speakers: normalizedSpeakers });
            this.chunkCache.set(canvasIdx, cached);

            // ========================
            // 최종 청크일 경우만 DB 저장
            // ========================
            let sttSessionIdx: number = 0;
            let contextText = '';

            if (isFinalChunk) {
                // 세션 존재 확인 / 생성
                const sessionRecord: any = await this.databaseService.query(
                    'SELECT stt_session_idx FROM stt_transcriptions WHERE canvas_idx = ?',
                    [canvasIdx],
                );

                if (!sessionRecord.length) {
                    // 신규 세션 생성
                    const insertResult: any = await this.databaseService.query(
                        'INSERT INTO stt_transcriptions (canvas_idx, mentor_idx, mentee_idx, audio_url) VALUES (?, ?, ?, ?)',
                        [
                            canvasIdx,
                            mentorIdx,
                            menteeIdx,
                            cached.chunks.map((c) => c.audioUrl).join(',' /* 또는 다른 구분 */),
                        ],
                    );
                    sttSessionIdx = insertResult.insertId as number;
                } else {
                    sttSessionIdx = sessionRecord[0].stt_session_idx as number;
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

                // 컨텍스트 생성
                const allSegments = await this.databaseService.query(
                    `SELECT speaker_idx, text_content, start_time, end_time
                     FROM stt_speaker_segments
                     WHERE stt_session_idx = ?
                     ORDER BY start_time`,
                    [sttSessionIdx],
                );

                contextText = this.extractContextText(
                    allSegments.map(
                        (s: {
                            speaker_idx: number;
                            text_content: string;
                            start_time: number;
                            end_time: number;
                        }) => ({
                            speakerTag: s.speaker_idx,
                            text: s.text_content,
                            startTime: s.start_time,
                            endTime: s.end_time,
                        }),
                    ),
                );

                // 캐시 제거
                this.chunkCache.delete(canvasIdx);
            }

            return {
                success: true,
                timestamp: new Date().toISOString(),
                processingTime: Date.now() - startTime,
                sttSessionIdx: sttSessionIdx,
                contextText,
                audioUrl: gcsResult.url || '',
                speakers: normalizedSpeakers.map((s) => ({
                    speakerTag: s.speakerTag,
                    textContent: s.text_Content,
                    startTime: s.startTime,
                    endTime: s.endTime,
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
    @Get('session-messages/:canvasIdx')
    async getSessionMessages(@Param('canvasIdx') canvasIdx: string) {
        try {
            // ✅ 1번의 JOIN 쿼리로 모든 데이터 조회
            const rows: any[] = await this.databaseService.query(
                `SELECT st.stt_session_idx, st.audio_url, st.created_at,
                    st.mentor_idx, st.mentee_idx,
                    mentor.name as mentor_name, mentee.name as mentee_name,
                    seg.speaker_idx, seg.text_content, seg.start_time, seg.end_time
             FROM stt_transcriptions st
             JOIN users mentor ON st.mentor_idx = mentor.idx
             JOIN users mentee ON st.mentee_idx = mentee.idx
             LEFT JOIN stt_speaker_segments seg ON st.stt_session_idx = seg.stt_session_idx
             WHERE st.canvas_idx = ?
             ORDER BY st.created_at DESC, seg.start_time ASC`,
                [canvasIdx],
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
                        speakerInfo: {
                            mentor: row.mentor_name as string,
                            mentee: row.mentee_name as string,
                        },
                        canvasIdx: parseInt(canvasIdx, 10),
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
        speakers: Array<{ speakerTag: number; text: string; startTime: number; endTime: number }>,
    ): string {
        if (!speakers?.length) return '';
        return speakers
            .sort((a, b) => a.startTime - b.startTime)
            .map((seg) => seg.text.trim())
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
