import { IsArray, IsString, ValidateNested } from 'class-validator';
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
}
