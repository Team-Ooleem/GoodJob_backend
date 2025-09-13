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

    static cleanWordPieceTokens(text: string): string {
        if (!text || typeof text !== 'string') return '';

        return (
            text
                // 1단계: 모든 특수 문자 제거 (언더스코어, 공백 등)
                .replace(/[▁_\s]+/g, '')
                // 2단계: 연속된 한글 자모를 단어로 결합
                .replace(/([가-힣])([가-힣])/g, '$1$2')
                // 3단계: 의미 있는 단어 경계에 띄어쓰기 추가
                .replace(/([가-힣]{2,})([가-힣]{2,})/g, '$1 $2')
                // 4단계: 조사와 어미 분리
                .replace(/([가-힣]{2,})([이가을를의에에서와과도는은])/g, '$1 $2')
                // 5단계: 최종 공백 정리
                .replace(/\s+/g, ' ')
                .trim()
        );
    }
    static improveKoreanGrammar(speakers: SpeakerSegment[]): SpeakerSegment[] {
        return speakers.map((speaker) => {
            let text = speaker.text_Content;

            // 문법적 오류 교정
            text = text
                // 조사 오류 교정
                .replace(/이 가/g, '이가')
                .replace(/을 를/g, '을를')
                .replace(/의 에/g, '의에')
                .replace(/에서 와/g, '에서와')

                // 어미 오류 교정
                .replace(/습니다 어요/g, '습니다어요')
                .replace(/어요 아요/g, '어요아요')
                .replace(/입니다 예요/g, '입니다예요')

                // 연결어미 교정
                .replace(/하고 하면서/g, '하고하면서')
                .replace(/그래서 그런데/g, '그래서그런데')

                // 띄어쓰기 정리
                .replace(/\s+/g, ' ')
                .trim();

            return {
                ...speaker,
                text_Content: text,
            };
        });
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

        // 1단계: WordPiece 토큰 정리
        let corrected = this.cleanWordPieceTokens(text);

        // 2단계: 기본 교정
        corrected = SpeechPatternsUtil.correctText(corrected);

        // 3단계: 불필요한 단어 제거
        corrected = this.removeUnnecessaryWords(corrected);

        // 4단계: 문장 부호 정리
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
