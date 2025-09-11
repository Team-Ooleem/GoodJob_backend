import {
    Injectable,
    Logger,
    BadRequestException,
    InternalServerErrorException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ChatMessage } from '../entities/transcription';
import { SessionDetailData, SegmentData } from '../entities/speaker-segment';

@Injectable()
export class STTMessageService {
    private readonly logger = new Logger(STTMessageService.name);

    constructor(private readonly databaseService: DatabaseService) {}

    // 세션 메시지 조회
    async getSessionMessages(canvasId: string, page: string = '1', limit: string = '20') {
        try {
            const pageNum = parseInt(page, 10) || 1;
            const limitNum = parseInt(limit, 10) || 20;
            const offset = (pageNum - 1) * limitNum;

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
}
