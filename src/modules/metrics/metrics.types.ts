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

    // 랜드마크 평균(존재하는 것만)
    landmarks_mean?: {
        leftEye?: { x: number; y: number };
        rightEye?: { x: number; y: number };
        nose?: { x: number; y: number };
    };

    // 샘플 시간 범위(선택)
    startedAt?: number;
    endedAt?: number;
};

export type SessionVisualAggregate = {
    perQuestion: Record<string, QuestionVisualAggregate>;
    overall: Omit<QuestionVisualAggregate, 'landmarks_mean'> & {
        // 전체는 랜드마크 평균은 생략(질문별에만 보관), 필요 시 가중 평균으로 계산 가능
    };
};
