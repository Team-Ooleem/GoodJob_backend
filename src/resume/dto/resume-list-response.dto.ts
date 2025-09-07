// dto/resume-list-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class ResumeListResponseDto {
    @ApiProperty({ description: '이력서 ID', example: 1 })
    id: number;

    @ApiProperty({ description: '이력서 제목', example: '프론트엔드 개발자 이력서' })
    title: string;

    @ApiProperty({ description: '포지션', example: 'Frontend Developer' })
    position: string;

    @ApiProperty({ description: '회사명', example: 'TechCorp' })
    company: string;

    @ApiProperty({ description: '생성일', example: '2024-01-15' })
    createdAt: string;

    @ApiProperty({ description: '총 경력', example: '3년' })
    experience: string;

    @ApiProperty({
        description: '보유 기술 목록',
        example: ['React', 'TypeScript', 'Next.js', 'Tailwind CSS'],
        type: [String],
    })
    skills: string[];
}
