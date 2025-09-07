import { IsInt, IsNumber, IsOptional } from 'class-validator';

export class VisualAggregateDto {
    @IsInt() sample_count!: number;

    @IsOptional() @IsNumber() confidence_mean?: number | null;
    @IsOptional() @IsNumber() confidence_max?: number | null;
    @IsOptional() @IsNumber() smile_mean?: number | null;
    @IsOptional() @IsNumber() smile_max?: number | null;

    @IsInt() presence_good!: number;
    @IsInt() presence_average!: number;
    @IsInt() presence_needs_improvement!: number;

    @IsInt() level_ok!: number;
    @IsInt() level_info!: number;
    @IsInt() level_warning!: number;
    @IsInt() level_critical!: number;

    @IsOptional() @IsNumber() left_eye_x_mean?: number | null;
    @IsOptional() @IsNumber() left_eye_y_mean?: number | null;
    @IsOptional() @IsNumber() right_eye_x_mean?: number | null;
    @IsOptional() @IsNumber() right_eye_y_mean?: number | null;
    @IsOptional() @IsNumber() nose_x_mean?: number | null;
    @IsOptional() @IsNumber() nose_y_mean?: number | null;

    @IsOptional() @IsNumber() started_at_ms?: number | null;
    @IsOptional() @IsNumber() ended_at_ms?: number | null;
}
