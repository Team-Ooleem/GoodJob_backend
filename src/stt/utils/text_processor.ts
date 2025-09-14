import { SpeakerSegment } from '../entities/speaker-segment';
import { SpeechPatternsUtil } from './speech-patterms';

interface OverlapInfo {
    segment1: SpeakerSegment;
    segment2: SpeakerSegment;
    overlapStart: number;
    overlapEnd: number;
    overlapDuration: number;
    confidence: number;
}
export class TextProcessorUtil {
    // �� 화자 겹침 정보 타입 정의

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

    static splitLongSentences(speakers: SpeakerSegment[]): SpeakerSegment[] {
        const result: SpeakerSegment[] = [];

        for (const speaker of speakers) {
            const text = speaker.text_Content || '';

            // 의미 단위로 문장 분할 (길이 제한 완화)
            const sentences = this.splitTextByMeaningfulUnits(text);

            // 각 문장을 새로운 세그먼트로 만들기
            const segmentDuration = speaker.endTime - speaker.startTime;
            const avgDurationPerSentence = segmentDuration / sentences.length;

            sentences.forEach((sentence, index) => {
                const startTime = speaker.startTime + index * avgDurationPerSentence;
                const endTime = speaker.startTime + (index + 1) * avgDurationPerSentence;

                result.push({
                    ...speaker,
                    text_Content: sentence.trim(),
                    startTime: Math.round(startTime * 10) / 10,
                    endTime: Math.round(endTime * 10) / 10,
                });
            });
        }

        return result;
    }

    // 의미 단위로 문장 분할하는 새로운 메서드
    private static splitTextByMeaningfulUnits(text: string): string[] {
        if (!text.trim()) return [];

        // 1. 문장 끝 패턴으로 분리 (.!? 그리고 그 뒤의 공백)
        const sentences = text
            .split(/([.!?])\s+/)
            .filter((s) => s.trim().length > 0)
            .reduce((acc, curr, index, array) => {
                if (index % 2 === 0) {
                    const punctuation = array[index + 1] || '';
                    acc.push(curr.trim() + punctuation);
                }
                return acc;
            }, [] as string[]);

        // 2. 문장 끝으로 분리되지 않은 경우, 의미 단위로 분리
        const finalSentences: string[] = [];
        for (const sentence of sentences) {
            if (sentence.length <= 100) {
                // 100자 이하면 그대로 유지
                finalSentences.push(sentence);
            } else {
                // 의미 단위로 분리
                finalSentences.push(...this.splitByMeaningfulBreaks(sentence));
            }
        }

        return finalSentences.filter((s) => s.trim().length > 0);
    }

    // 의미 있는 분할점에서 문장 분리
    private static splitByMeaningfulBreaks(text: string): string[] {
        const meaningfulBreaks = [
            // 문장 끝 패턴 (가장 자연스러운 분할점)
            '어요',
            '아요',
            '습니다',
            '입니다',
            '예요',
            '네요',
            '어요요',
            '아요요',
            // 강한 연결어
            '그래서',
            '그러나',
            '하지만',
            '그런데',
            '따라서',
            '그러므로',
            // 약한 연결어
            '그리고',
            '또한',
            '그러면',
            '그러니까',
            // 쉼표 (의미 단위 구분)
            ',',
            '，',
        ];

        const sentences: string[] = [];
        let remainingText = text.trim();

        while (remainingText.length > 100) {
            // 100자보다 길면 분할
            let bestSplitIndex = -1;
            let bestBreak = '';

            // 뒤에서부터 의미 있는 분할점 찾기
            for (const breakPoint of meaningfulBreaks) {
                const lastIndex = remainingText.lastIndexOf(breakPoint, 100);
                if (lastIndex > bestSplitIndex && lastIndex > 20) {
                    // 최소 20자 이상 유지
                    bestSplitIndex = lastIndex;
                    bestBreak = breakPoint;
                }
            }

            if (bestSplitIndex > 0) {
                // 문장 끝 패턴은 포함, 연결어는 제외하여 분할
                const isSentenceEnd = ['어요', '아요', '습니다', '입니다', '예요', '네요'].includes(
                    bestBreak,
                );
                const splitPoint = bestSplitIndex + (isSentenceEnd ? bestBreak.length : 0);
                sentences.push(remainingText.substring(0, splitPoint).trim());
                remainingText = remainingText.substring(splitPoint).trim();
            } else {
                // 의미 있는 분할점이 없으면 100자에서 강제 분할
                sentences.push(remainingText.substring(0, 100).trim());
                remainingText = remainingText.substring(100).trim();
            }
        }

        // 남은 텍스트 추가
        if (remainingText.trim().length > 0) {
            sentences.push(remainingText.trim());
        }

        return sentences;
    }

    // �� 전체 텍스트 교정 (화자 겹침 처리 추가)
    static processAndCorrectText(speakers: SpeakerSegment[]): SpeakerSegment[] {
        if (speakers.length === 0) return speakers;

        let processed = speakers.map((speaker) => ({
            ...speaker,
            text_Content: this.correctSpeakerText(speaker.text_Content),
        }));

        // �� 화자 겹침 처리 추가
        processed = this.resolveSpeakerOverlaps(processed);

        // 🆕 긴 문장 분리 적용
        processed = this.splitLongSentences(processed);

        return processed;
    }

    // �� 화자 겹침 해결 메인 함수
    private static resolveSpeakerOverlaps(speakers: SpeakerSegment[]): SpeakerSegment[] {
        if (speakers.length < 2) return speakers;

        const overlaps = this.detectOverlaps(speakers);
        if (overlaps.length === 0) return speakers;

        console.log(`🎯 화자 겹침 감지: ${overlaps.length}개 구간`);

        let resolved = [...speakers];

        // 겹침을 역순으로 처리 (인덱스 변경 방지)
        overlaps.reverse().forEach((overlap) => {
            resolved = this.resolveOverlap(resolved, overlap);
        });

        return resolved;
    }

    // �� 화자 겹침 감지
    private static detectOverlaps(speakers: SpeakerSegment[]): OverlapInfo[] {
        const overlaps: OverlapInfo[] = [];

        for (let i = 0; i < speakers.length - 1; i++) {
            const current = speakers[i];
            const next = speakers[i + 1];

            // 시간 겹침 감지
            if (current.endTime > next.startTime) {
                const overlapDuration = current.endTime - next.startTime;

                // 0.3초 이상 겹치면 처리 대상
                if (overlapDuration > 0.3) {
                    const overlap: OverlapInfo = {
                        segment1: current,
                        segment2: next,
                        overlapStart: next.startTime,
                        overlapEnd: current.endTime,
                        overlapDuration: overlapDuration,
                        confidence: this.calculateOverlapConfidence(current, next),
                    };

                    overlaps.push(overlap);
                    console.log(
                        `⚠️ 겹침 감지: ${overlapDuration.toFixed(2)}초 (화자${current.speakerTag} → 화자${next.speakerTag})`,
                    );
                }
            }
        }

        return overlaps;
    }

    // 🆕 겹침 신뢰도 계산
    private static calculateOverlapConfidence(
        segment1: SpeakerSegment,
        segment2: SpeakerSegment,
    ): number {
        let confidence = 0.5; // 기본값

        // 같은 화자면 높은 신뢰도
        if (segment1.speakerTag === segment2.speakerTag) {
            confidence += 0.3;
        }

        // 텍스트 길이 차이가 적으면 높은 신뢰도
        const lengthDiff = Math.abs(segment1.text_Content.length - segment2.text_Content.length);
        const avgLength = (segment1.text_Content.length + segment2.text_Content.length) / 2;
        const lengthRatio = lengthDiff / avgLength;

        if (lengthRatio < 0.3) {
            confidence += 0.2;
        }

        // 시간 겹침이 길면 높은 신뢰도
        const overlapDuration = segment1.endTime - segment2.startTime;
        const segment1Duration = segment1.endTime - segment1.startTime;
        const overlapRatio = overlapDuration / segment1Duration;

        if (overlapRatio > 0.5) {
            confidence += 0.2;
        }

        return Math.min(confidence, 1.0);
    }

    // �� 개별 겹침 해결
    private static resolveOverlap(
        speakers: SpeakerSegment[],
        overlap: OverlapInfo,
    ): SpeakerSegment[] {
        const index1 = speakers.findIndex(
            (s) =>
                s.startTime === overlap.segment1.startTime &&
                s.endTime === overlap.segment1.endTime &&
                s.speakerTag === overlap.segment1.speakerTag,
        );

        const index2 = speakers.findIndex(
            (s) =>
                s.startTime === overlap.segment2.startTime &&
                s.endTime === overlap.segment2.endTime &&
                s.speakerTag === overlap.segment2.speakerTag,
        );

        if (index1 === -1 || index2 === -1) {
            console.warn('⚠️ 겹침 해결 실패: 세그먼트를 찾을 수 없음');
            return speakers;
        }

        // 전략 선택
        if (overlap.confidence > 0.7) {
            // 높은 신뢰도: 병합
            return this.mergeOverlappingSegments(speakers, index1, index2, overlap);
        } else if (overlap.confidence > 0.4) {
            // 중간 신뢰도: 시간 조정
            return this.adjustOverlappingTimings(speakers, index1, index2, overlap);
        } else {
            // 낮은 신뢰도: 강제 분리
            return this.forceSeparateOverlapping(speakers, index1, index2, overlap);
        }
    }

    // 🆕 겹치는 세그먼트 병합
    private static mergeOverlappingSegments(
        speakers: SpeakerSegment[],
        index1: number,
        index2: number,
        overlap: OverlapInfo,
    ): SpeakerSegment[] {
        const segment1 = speakers[index1];
        const segment2 = speakers[index2];

        // 더 긴 텍스트를 기준으로 병합
        const primarySegment =
            segment1.text_Content.length > segment2.text_Content.length ? segment1 : segment2;

        // 새로운 병합된 세그먼트 생성
        const mergedSegment: SpeakerSegment = {
            ...primarySegment,
            text_Content: this.mergeTexts(segment1.text_Content, segment2.text_Content),
            startTime: Math.min(segment1.startTime, segment2.startTime),
            endTime: Math.max(segment1.endTime, segment2.endTime),
        };

        // 기존 세그먼트들 제거하고 병합된 세그먼트 추가
        speakers.splice(index1, 2, mergedSegment);

        console.log(
            `✅ 세그먼트 병합 완료: "${mergedSegment.text_Content}" (겹침: ${overlap.overlapDuration.toFixed(2)}초)`,
        );
        return speakers;
    }

    // 🆕 겹침 시간 조정
    private static adjustOverlappingTimings(
        speakers: SpeakerSegment[],
        index1: number,
        index2: number,
        overlap: OverlapInfo,
    ): SpeakerSegment[] {
        const segment1 = speakers[index1];
        const segment2 = speakers[index2];

        // 겹침 구간의 절반씩 분배
        const adjustment = overlap.overlapDuration / 2;

        // 첫 번째 세그먼트의 끝 시간 조정
        speakers[index1] = {
            ...segment1,
            endTime: segment1.endTime - adjustment,
        };

        // 두 번째 세그먼트의 시작 시간 조정
        speakers[index2] = {
            ...segment2,
            startTime: segment2.startTime + adjustment,
        };

        console.log(`⏰ 시간 조정 완료: ${adjustment.toFixed(2)}초씩 분배`);
        return speakers;
    }

    // 🆕 강제 분리
    private static forceSeparateOverlapping(
        speakers: SpeakerSegment[],
        index1: number,
        index2: number,
        overlap: OverlapInfo,
    ): SpeakerSegment[] {
        const segment1 = speakers[index1];
        const segment2 = speakers[index2];

        // 겹침 구간을 완전히 분리
        const midpoint = (overlap.overlapStart + overlap.overlapEnd) / 2;

        speakers[index1] = {
            ...segment1,
            endTime: midpoint,
        };

        speakers[index2] = {
            ...segment2,
            startTime: midpoint + 0.1, // 0.1초 간격 추가
        };

        console.log(`✂️ 강제 분리 완료: 중점 ${midpoint.toFixed(2)}초`);
        return speakers;
    }

    // 🆕 텍스트 병합 유틸리티
    private static mergeTexts(text1: string, text2: string): string {
        // 중복 단어 제거
        const words1 = text1.trim().split(/\s+/);
        const words2 = text2.trim().split(/\s+/);

        // 마지막 단어가 첫 번째 단어와 같으면 제거
        if (words1.length > 0 && words2.length > 0 && words1[words1.length - 1] === words2[0]) {
            words2.shift();
        }

        return [...words1, ...words2].join(' ');
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
