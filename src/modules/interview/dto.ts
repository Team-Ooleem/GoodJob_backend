// apps/api/src/modules/interview/dto.ts
export type MediaPipeMetrics = {
    confidence?: number;
    blink_rate?: number;
    gaze_stability?: number;
    expression_activity?: number;
    [k: string]: number | undefined;
};

// 여기 AI서버와 동일하게 맞춰야 합니다
export type AudioMetrics = {
    f0_mean: number;
    f0_std: number;
    rms_std: number;
    rms_cv: number;
    jitter_like: number;
    shimmer_like: number;
    silence_ratio: number;
    sr: number;
};

export type QuestionRecord = {
    questionId: string;
    prompt: string;
    userAnswerText?: string;
    audioMetrics?: AudioMetrics;
    visualMetrics?: MediaPipeMetrics;
    ts: number;
};

export type SessionAggregate = {
    sessionId: string;
    questions: QuestionRecord[];
    overall: {
        speaking_stability: number; // 예: f0_std, jitter/shimmer, silence 등 가중합
        energy_control: number; // 예: rms_cv 기반 점수
        confidence_proxy: number; // 예: visual confidence + f0_mean 범위 보정
    };
};
