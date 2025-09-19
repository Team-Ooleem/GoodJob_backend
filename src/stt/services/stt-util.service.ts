import { Injectable } from '@nestjs/common';
import { SpeakerSegment, MappedSpeakerSegment } from '../entities/speaker-segment';
import { DatabaseService } from '../../database/database.service';
@Injectable()
export class STTUtilService {
    constructor(private readonly databaseService: DatabaseService) {}

    // Base64 검증
    isValidBase64(str: string): boolean {
        try {
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(str) || str.length % 4 !== 0) return false;
            Buffer.from(str, 'base64');
            return true;
        } catch {
            return false;
        }
    }

    // 화자 매핑
    mapSpeakersToUsers(
        speakers: SpeakerSegment[] | undefined,
        mentorIdx: number,
        menteeIdx: number,
    ): MappedSpeakerSegment[] {
        if (!speakers) return [];
        return speakers.map((seg) => ({
            userId: seg.speakerTag === 0 ? mentorIdx : menteeIdx,
            text_Content: seg.text_Content,
            startTime: seg.startTime,
            endTime: seg.endTime,
        }));
    }

    // 컨텍스트 텍스트 추출
    extractContextText(
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

    async getParticipants(canvasId: string, mentorIdx?: number, menteeIdx?: number) {
        const participants = (await this.databaseService.execute(
            `SELECT cp.user_id, mp.mentor_idx, mp.is_approved 
             FROM canvas_participant cp
             LEFT JOIN mentor_profiles mp ON cp.user_id = mp.user_idx
             WHERE cp.canvas_id = ?`,
            [canvasId],
        )) as Array<{ user_id: number; mentor_idx: number | null; is_approved: number | null }>;

        const mentorUser = participants.find((p) => p.mentor_idx && p.is_approved === 1) || null;
        const menteeUser = participants.find((p) => !p.mentor_idx || p.is_approved !== 1) || null;

        return {
            actualMentorIdx: mentorUser?.user_id || mentorIdx,
            actualMenteeIdx: menteeUser?.user_id || menteeIdx,
        };
    }
}
