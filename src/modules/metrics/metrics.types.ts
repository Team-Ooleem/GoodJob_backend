// src/modules/metrics/metrics.types.ts
export type VisualSample = {
    ts: number; // ms since epoch
    confidenceScore?: number;
    smileIntensity?: number;
    presence?: 'good' | 'average' | 'needs_improvement';
    level?: 'ok' | 'info' | 'warning' | 'critical';
    landmarks?: {
        leftEye?: { x: number; y: number };
        rightEye?: { x: number; y: number };
        nose?: { x: number; y: number };
    };
};

export type QuestionVisualAggregate = {
    count: number;
    // 평균/최댓값 등
    confidence_mean?: number;
    confidence_max?: number;
    smile_mean?: number;
    smile_max?: number;

    // presence 분포
    presence_dist: Record<'good' | 'average' | 'needs_improvement', number>;
    // level 분포
    level_dist: Record<'ok' | 'info' | 'warning' | 'critical', number>;

    // 샘플 시간 범위(선택)
    startedAt?: number;
    endedAt?: number;
};

export type SessionVisualAggregate = {
    perQuestion: Record<string, QuestionVisualAggregate>;
    overall: QuestionVisualAggregate;
};
