import { IsArray, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class QADto {
    @IsString()
    question!: string;

    @IsString()
    answer!: string;
}

export class AnalyzeReportDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => QADto)
    qa!: QADto[];

    // LLM 기반 내용/맥락 점수(0~100), 선택 전달
    @IsOptional()
    @IsNumber()
    llmContentScore?: number;

    @IsOptional()
    @IsNumber()
    llmContextScore?: number;
}
