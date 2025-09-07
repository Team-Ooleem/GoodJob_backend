// dto/create-resume.dto.ts
import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateResumeDto {
    @ApiProperty({ description: '이력서 제목', example: '프론트엔드 개발자 이력서' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    title: string;
}
