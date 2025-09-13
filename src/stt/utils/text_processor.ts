import { SpeakerSegment } from '../entities/speaker-segment';
import { SpeechPatternsUtil } from './speech-patterms';

export class TextProcessorUtil {
    // 시간 정규화
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

    // WordPiece 토큰 정리 (전처리 전용)
    static cleanWordPieceTokens(text: string): string {
        if (!text || typeof text !== 'string') return '';

        return text
            .replace(/[▁_\s]+/g, ' ') // 특수 문자/불필요한 공백 제거
            .trim();
    }

    // 규칙 기반 띄어쓰기 교정
    static fixSpacing(text: string): string {
        if (!text) return text;

        let fixed = text;

        // 조사 앞은 붙이기
        fixed = fixed.replace(
            /([가-힣])\s+(을|를|이|가|은|는|의|에|에서|와|과|도|만|까지|부터|처럼|보다)/g,
            '$1$2',
        );

        // 접속사/부사 앞은 띄우기
        fixed = fixed.replace(/([가-힣])\s*(그래서|그리고|그러나|하지만|또는|그러면)/g, '$1 $2');

        // 자주 쓰이는 단어 합치기 (사전 기반)
        const commonWords = ['오늘날씨', '한국사람', '컴퓨터비전'];
        for (const word of commonWords) {
            const spaced = word.split('').join(' ');
            fixed = fixed.replace(new RegExp(spaced, 'g'), word);
        }

        // 공백 정리
        fixed = fixed.replace(/\s+/g, ' ').trim();
        return fixed;
    }

    // 문법 오류 교정
    static improveKoreanGrammar(speakers: SpeakerSegment[]): SpeakerSegment[] {
        return speakers.map((speaker) => {
            let text = speaker.text_Content || '';

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

                // 구두점 정리
                .replace(/\s*([.,!?])\s*/g, '$1 ')
                .replace(/([가-힣])\s*([.,!?])/g, '$1$2')

                // 띄어쓰기 정리
                .replace(/\s+/g, ' ')
                .trim();

            return {
                ...speaker,
                text_Content: text,
            };
        });
    }

    // 전체 텍스트 교정
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

        let corrected = this.cleanWordPieceTokens(text); // 1. 전처리
        corrected = this.fixSpacing(corrected); // 2. 띄어쓰기 교정
        corrected = SpeechPatternsUtil.correctText(corrected); // 3. 기본 교정
        corrected = this.removeUnnecessaryWords(corrected); // 4. 군더더기 제거
        corrected = this.cleanPunctuation(corrected); // 5. 구두점 정리

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
