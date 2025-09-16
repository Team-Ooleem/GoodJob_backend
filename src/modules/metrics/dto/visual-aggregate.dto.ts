import { IsInt, IsNumber, IsOptional } from 'class-validator';

export class VisualAggregateDto {
    @IsInt() sample_count!: number;

    @IsOptional() @IsNumber() confidence_mean?: number | null;
    @IsOptional() @IsNumber() confidence_max?: number | null;
    @IsOptional() @IsNumber() smile_mean?: number | null;
    @IsOptional() @IsNumber() smile_max?: number | null;

    // 추가 지표(평균/최대 등) - 프론트 RealMediaPipeAnalyzer와 정렬
    @IsOptional() @IsNumber() eye_contact_mean?: number | null; // 0~1
    @IsOptional() @IsNumber() blink_mean?: number | null; // 0~1
    @IsOptional() @IsNumber() gaze_stability?: number | null; // 0~1

    @IsOptional() @IsNumber() attention_mean?: number | null; // 0~1
    @IsOptional() @IsNumber() attention_max?: number | null; // 0~1
    @IsOptional() @IsNumber() engagement_mean?: number | null; // 0~1
    @IsOptional() @IsNumber() engagement_max?: number | null; // 0~1
    @IsOptional() @IsNumber() nervousness_mean?: number | null; // 0~1
    @IsOptional() @IsNumber() nervousness_max?: number | null; // 0~1

    @IsInt() presence_good!: number;
    @IsInt() presence_average!: number;
    @IsInt() presence_needs_improvement!: number;

    @IsInt() level_ok!: number;
    @IsInt() level_info!: number;
    @IsInt() level_warning!: number;
    @IsInt() level_critical!: number;

    @IsOptional() @IsNumber() started_at_ms?: number | null;
    @IsOptional() @IsNumber() ended_at_ms?: number | null;
}
