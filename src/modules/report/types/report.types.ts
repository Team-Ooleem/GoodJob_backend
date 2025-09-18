import { AudioSummary } from '../services/audio-analysis.service';
import { VisualSummary } from '../services/visual-analysis.service';
import { TextAnalysisResult } from '../services/text-analysis.service';
import { ExpressionIndices, CalibrationInfo } from '../services/score-calculation.service';

export type InterviewAnalysisResult = {
    overall_score: number; // 0~100 (내용30 + 맥락30 + 표현40)
    detailed_scores: {
        content30: number;
        context30: number;
        expression40: number;
    };
    expression_indices: ExpressionIndices;
    calibration_info?: CalibrationInfo;
    // 종합 음성 지표 및 문항별 정규화 점수 (프론트 표시용)
    audio_summary?: AudioSummary;
    // 종합 영상 지표 및 문항별 정규화 점수 (프론트 표시용)
    visual_summary?: VisualSummary;
    // 텍스트(내용/맥락) LLM 집계 요약
    text_analysis_summary?: {
        content_avg100: number; // 문항별 content_score 평균(0-100)
        context_avg100: number; // 문항별 context_score 평균(0-100)
        overall_llm10: number; // LLM 텍스트 종합(0-10)
        top_reasons?: string[]; // 근거 bullet 상위(중복 제거)
        top_improvements?: string[]; // 개선 팁 상위(중복 제거)
    };
    // 프론트 하이라이트용 근거 링크(상위 N개)
    evidence_links?: Array<{
        answer_span: string;
        resume_ref?: string;
        similarity?: number;
        explanation?: string;
    }>;
    // 이력서 요약 기반 1분 자기소개 대본
    self_intro_script?: string;
};
