import { SpeakerSegment } from '../entities/speaker-segment';

export class TextProcessorUtil {
    static normalizeTimings(speakers: SpeakerSegment[], actualDuration: number): SpeakerSegment[] {
        if (speakers.length === 0) return speakers;

        // 한 번의 순회로 최대값 찾기
        const maxSttTime = speakers.reduce((max, speaker) => Math.max(max, speaker.endTime), 0);
        const scaleFactor = actualDuration / maxSttTime;

        // 정규화
        return speakers.map((speaker) => ({
            ...speaker,
            startTime: Math.round(speaker.startTime * scaleFactor * 10) / 10,
            endTime: Math.round(speaker.endTime * scaleFactor * 10) / 10,
        }));
    }
}
