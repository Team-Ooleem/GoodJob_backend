import { Injectable } from '@nestjs/common';
import { SpeakerSegment, MappedSpeakerSegment } from '../entities/speaker-segment';

@Injectable()
export class STTUtilService {
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
            userId: seg.speakerTag === 1 ? mentorIdx : menteeIdx,
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
}
