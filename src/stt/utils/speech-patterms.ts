export class SpeechPatternsUtil {
    static readonly SPEECH_CONTEXTS = [
        {
            phrases: [
                // 코칭/멘토링 관련 용어
                '코칭',
                '멘토링',
                '피드백',
                '목표',
                '성장',
                '개발',
                '스킬',
                '역량',
                '액티브 리스닝',
                '마인드셋',
                '성과',
                '개선',
                '도전',
                '기회',
                '상담',
                '조언',
                '가이드',
                '지원',
                '동기부여',
                '리더십',

                // 대화 연결어 (자연스러운 문장을 위해)
                '그리고',
                '그러니까',
                '그런데',
                '그래서',
                '그러면',
                '그 다음에',
                '그리고 나서',
                '음...',
                '어...',

                // 기술 용어
                'STT',
                'TTS',
                'AI',
                'API',
                'DB',
                'SQL',
                'HTML',
                'CSS',
                'JS',
                'JavaScript',
                'TypeScript',
                'React',
                'Vue',
                'Angular',
                'Node.js',
                'Python',
                'Java',
                'Spring',
                'Django',
                'AWS',
                'Docker',
                'Kubernetes',
                'Git',
                'GitHub',
                '프론트엔드',
                '백엔드',
                '풀스택',
                '데이터베이스',
                '서버',
                '클라이언트',
                '배포',
                '테스트',
                '디버깅',

                // 면접 관련
                '면접',
                '질문',
                '답변',
                '경험',
                '프로젝트',
                '회사',
                '개발',
                '프로그래밍',
                '코딩',
                '기술',
                '스킬',

                // 기본 인사말
                '안녕하세요',
                '감사합니다',
                '죄송합니다',
                '네',
                '아니요',
                'hello',
                'thank you',
                'sorry',
                'yes',
                'no',
            ],
            boost: 20.0,
        },
    ];

    // 엉뚱한 단어 교정 사전
    static readonly WORD_CORRECTIONS = new Map([
        // 코칭 관련
        ['코칭이', '코칭'],
        ['멘토링이', '멘토링'],
        ['피드백이', '피드백'],
        ['목표가', '목표'],
        ['성장이', '성장'],
        ['개발이', '개발'],
        ['스킬이', '스킬'],
        ['역량이', '역량'],

        // 기술 용어
        ['에스티티', 'STT'],
        ['티티에스', 'TTS'],
        ['에이아이', 'AI'],
        ['에이피아이', 'API'],
        ['디비', 'DB'],
        ['에스큐엘', 'SQL'],
        ['에이치티엠엘', 'HTML'],
        ['씨에스에스', 'CSS'],
        ['제이에스', 'JS'],
        ['자바스크립트', 'JavaScript'],
        ['타입스크립트', 'TypeScript'],
        ['리액트', 'React'],
        ['뷰', 'Vue'],
        ['앵귤러', 'Angular'],
        ['노드제이에스', 'Node.js'],
        ['파이썬', 'Python'],
        ['자바', 'Java'],
        ['스프링', 'Spring'],
        ['장고', 'Django'],
        ['에이더블유에스', 'AWS'],
        ['도커', 'Docker'],
        ['쿠버네티스', 'Kubernetes'],
        ['깃', 'Git'],
        ['깃허브', 'GitHub'],

        // 일반적인 오인식
        ['그리고', '그리고'],
        ['그러니까', '그러니까'],
        ['그런데', '그런데'],
        ['그래서', '그래서'],
        ['그러면', '그러면'],
        ['음', '음'],
        ['어', '어'],
        ['아', '아'],
    ]);

    // 문장 정리 및 교정
    static correctText(text: string): string {
        if (!text || typeof text !== 'string') return '';

        let correctedText = text.trim();

        // 단어별 교정 적용
        for (const [wrong, correct] of this.WORD_CORRECTIONS) {
            const regex = new RegExp(`\\b${wrong}\\b`, 'gi');
            correctedText = correctedText.replace(regex, correct);
        }

        // 불필요한 반복 제거
        correctedText = correctedText.replace(/\s+/g, ' '); // 여러 공백을 하나로
        correctedText = correctedText.replace(/(.)\1{2,}/g, '$1$1'); // 3번 이상 반복 제거

        return correctedText.trim();
    }

    // 문장 연결성 개선 (SpeakerSegment 배열을 받도록 수정)
    static improveSentenceFlow(
        speakers: Array<{
            text_Content: string;
            startTime: number;
            endTime: number;
            speakerTag: number;
        }>,
    ): Array<{ text_Content: string; startTime: number; endTime: number; speakerTag: number }> {
        if (speakers.length <= 1) return speakers;

        const improved: Array<{
            text_Content: string;
            startTime: number;
            endTime: number;
            speakerTag: number;
        }> = [];
        let currentSpeaker = speakers[0];

        for (let i = 1; i < speakers.length; i++) {
            const nextSpeaker = speakers[i];
            const timeGap = this.calculateTimeGap(currentSpeaker, nextSpeaker);

            // 짧은 문장이고 시간 간격이 가까우면 합치기
            if (nextSpeaker.text_Content.length < 10 && timeGap < 2.0) {
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

    private static calculateTimeGap(
        prev: { startTime: number; endTime: number },
        next: { startTime: number; endTime: number },
    ): number {
        return next.startTime - prev.endTime;
    }
}
