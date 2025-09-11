import { SpeakerSegment } from '../entities/speaker-segment';
import { SpeechPatternsUtil } from './speech-patterms';

export class TextProcessorUtil {
    static normalizeTimings(speakers: SpeakerSegment[], actualDuration: number): SpeakerSegment[] {
        if (speakers.length === 0) return speakers;

        const maxSttTime = speakers.reduce((max, speaker) => Math.max(max, speaker.endTime), 0);
        const scaleFactor = actualDuration / maxSttTime;

        return speakers.map((speaker) => ({
            ...speaker,
            startTime: Math.round(speaker.startTime * scaleFactor * 10) / 10,
            endTime: Math.round(speaker.endTime * scaleFactor * 10) / 10,
        }));
    }

    // 엉뚱한 단어 교정 및 문장 개선
    static processAndCorrectText(speakers: SpeakerSegment[]): SpeakerSegment[] {
        if (speakers.length === 0) return speakers;

        return speakers.map((speaker) => ({
            ...speaker,
            text_Content: this.correctSpeakerText(speaker.text_Content),
        }));
    }

    // 화자별 텍스트 교정
    private static correctSpeakerText(text: string): string {
        if (!text || typeof text !== 'string') return '';

        // 1단계: 기본 교정
        let corrected = SpeechPatternsUtil.correctText(text);

        // 2단계: 불필요한 단어 제거
        corrected = this.removeUnnecessaryWords(corrected);

        // 3단계: 문장 부호 정리
        corrected = this.cleanPunctuation(corrected);

        return corrected.trim();
    }

    // 불필요한 단어 제거
    private static removeUnnecessaryWords(text: string): string {
        const unnecessaryWords = [
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
            '음...',
            '어...',
            '그러니까...',
        ];

        let cleaned = text;
        for (const word of unnecessaryWords) {
            const regex = new RegExp(`\\b${word}\\b`, 'gi');
            cleaned = cleaned.replace(regex, '');
        }

        return cleaned.replace(/\s+/g, ' ').trim();
    }

    // 문장 부호 정리
    private static cleanPunctuation(text: string): string {
        return text
            .replace(/[.,!?;:]{2,}/g, '.') // 연속된 구두점을 하나로
            .replace(/\s+([.,!?;:])/g, '$1') // 구두점 앞 공백 제거
            .replace(/([.,!?;:])\s*([.,!?;:])/g, '$1') // 연속된 구두점 정리
            .trim();
    }

    // 문장 연결성 개선
    static improveConversationFlow(speakers: SpeakerSegment[]): SpeakerSegment[] {
        if (speakers.length <= 1) return speakers;

        const improved: SpeakerSegment[] = [];
        let currentSpeaker = speakers[0];

        for (let i = 1; i < speakers.length; i++) {
            const nextSpeaker = speakers[i];
            const timeGap = nextSpeaker.startTime - currentSpeaker.endTime;
            const isShortSegment = nextSpeaker.text_Content.length < 8;
            const isCloseInTime = timeGap < 2.0;
            const isSameSpeaker = nextSpeaker.speakerTag === currentSpeaker.speakerTag;

            // 합치기 조건
            if (isShortSegment && isCloseInTime && isSameSpeaker) {
                currentSpeaker = {
                    ...currentSpeaker,
                    text_Content: currentSpeaker.text_Content + ' ' + nextSpeaker.text_Content,
                    endTime: nextSpeaker.endTime,
                };
            } else {
                improved.push(currentSpeaker);
                currentSpeaker = nextSpeaker;
            }
        }

        improved.push(currentSpeaker);
        return improved;
    }
}
