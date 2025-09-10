import { SpeakerSegment } from '../entities/speaker-segment';

export class TextProcessorUtil {
    static normalizeTimings(speakers: SpeakerSegment[], actualDuration: number): SpeakerSegment[] {
        if (speakers.length === 0) return speakers;

        const maxSttTime = Math.max(...speakers.map((s) => s.endTime));
        const scaleFactor = actualDuration / maxSttTime;

        return speakers.map((speaker) => ({
            ...speaker,
            startTime: Math.round(speaker.startTime * scaleFactor * 10) / 10,
            endTime: Math.round(speaker.endTime * scaleFactor * 10) / 10,
        }));
    }
}
