import {
    Injectable,
    Logger,
    BadRequestException,
    InternalServerErrorException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { SessionDetailData, SegmentData } from '../entities/speaker-segment';
import { RawSessionData, TransformedSession } from '../entities/transcription';
@Injectable()
export class STTMessageService {
    private readonly logger = new Logger(STTMessageService.name);

    constructor(private readonly databaseService: DatabaseService) {}

    // 🆕 nested 구조로 변환하는 함수 (타입 적용)
    private transformToFrontendFormat(rawData: RawSessionData[]): TransformedSession[] {
        const sessionMap = new Map<number, TransformedSession>();

        rawData.forEach((row) => {
            const sessionId = row.stt_session_idx;

            if (!sessionMap.has(sessionId)) {
                sessionMap.set(sessionId, {
                    messageId: sessionId,
                    audioUrl: row.audio_url,
                    timestamp: row.created_at,
                    mentor_idx: row.mentor_idx,
                    mentee_idx: row.mentee_idx,
                    segments: [],
                    audioDuration: 0,
                });
            }
            const session = sessionMap.get(sessionId)!;

            if (row.text_content && row.start_time !== null && row.end_time !== null) {
                session.segments.push({
                    speakerTag: row.speaker_idx,
                    textContent: row.text_content,
                    startTime: parseFloat(row.start_time.toString()),
                    endTime: parseFloat(row.end_time.toString()),
                });
            }
        });

        return Array.from(sessionMap.values()).map((session) => {
            session.segments.sort((a, b) => a.startTime - b.startTime);
            session.audioDuration =
                session.segments.length > 0
                    ? Math.max(...session.segments.map((s) => s.endTime))
                    : 0;
            return session;
        });
    }

    // 세션 메시지 조회 (단순화된 버전)
    async getSessionMessages(canvasId: string, page: string = '1', limit: string = '20') {
        try {
            const pageNum = parseInt(page, 10) || 1;
            const limitNum = parseInt(limit, 10) || 20;
            const offset = (pageNum - 1) * limitNum;

            // 🆕 단순화된 쿼리
            const rows = await this.databaseService.query<RawSessionData>(
                `SELECT 
                    st.stt_session_idx,
                    st.audio_url,
                    st.created_at,
                    st.mentor_idx,
                    st.mentee_idx,
                    seg.speaker_idx,
                    seg.text_content,
                    seg.start_time,
                    seg.end_time
                FROM stt_transcriptions st    
                INNER JOIN stt_speaker_segments seg ON st.stt_session_idx = seg.stt_session_idx
                WHERE st.canvas_id = ? 
                    AND seg.text_content IS NOT NULL 
                    AND seg.text_content != ''
                ORDER BY st.created_at DESC, seg.start_time ASC
                LIMIT ? OFFSET ?`,
                [canvasId, limitNum, offset],
            );

            const countResult = await this.databaseService.query<{ total: number }>(
                `SELECT COUNT(DISTINCT st.stt_session_idx) as total
                 FROM stt_transcriptions st
                 WHERE st.canvas_id = ?`,
                [canvasId],
            );

            const totalCount: number = Array.isArray(countResult) ? countResult[0]?.total || 0 : 0; // 🆕 Remove the second condition since countResult is always an array
            // 🆕 변환 함수 사용
            const messages = this.transformToFrontendFormat(rows);

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

    // 메시지 상세 조회
    async getMessageDetail(sessionIdx: string) {
        try {
            const sessionInfo = await this.databaseService.query(
                `SELECT 
                    st.*,
                    mentor.name as mentor_name,
                    mentee.name as mentee_name
                FROM stt_transcriptions st
                JOIN users mentor ON st.mentor_idx = mentor.idx
                JOIN users mentee ON st.mentee_idx = mentee.idx
                WHERE st.stt_session_idx = ?`,
                [sessionIdx],
            );

            if (sessionInfo.length === 0) {
                throw new BadRequestException('세션을 찾을 수 없습니다.');
            }

            const segments = await this.databaseService.query(
                `SELECT 
                    speaker_idx,
                    text_content,
                    start_time,
                    end_time
                FROM stt_speaker_segments
                WHERE stt_session_idx = ?
                ORDER BY start_time`,
                [sessionIdx],
            );

            // 🆕 audioDuration 계산
            let audioDuration = 0;
            if (segments.length > 0) {
                const maxEndTime = Math.max(
                    ...segments.map((seg: SegmentData) => parseFloat(seg.end_time.toString())),
                );
                audioDuration = Math.round(maxEndTime * 10) / 10;
            }

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
                audioDuration,
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

    // 컨텍스트 텍스트 조회
    async getContextText(sessionIdx: number) {
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

    // 컨텍스트 텍스트 추출
    private extractContextText(
        speakers: Array<{
            speakerTag: number;
            text_content?: string;
            text?: string;
            startTime: number;
            endTime: number;
        }>,
    ): string {
        if (!speakers?.length) return '';
        return speakers
            .sort((a, b) => a.startTime - b.startTime)
            .map((seg) => (seg.text_content || seg.text || '').trim())
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
}
