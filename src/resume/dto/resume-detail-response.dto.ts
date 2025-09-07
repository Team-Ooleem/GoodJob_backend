// dto/resume-detail-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class ResumeCareerDto {
    @ApiProperty({ description: '경력 ID' })
    careerId: number;

    @ApiProperty({ description: '회사명' })
    companyName: string;

    @ApiProperty({ description: '포지션' })
    position: string;

    @ApiProperty({ description: '현재 재직 중 여부' })
    isCurrent: boolean;

    @ApiProperty({ description: '입사일', nullable: true })
    startDate: Date | null;

    @ApiProperty({ description: '퇴사일', nullable: true })
    endDate: Date | null;

    @ApiProperty({ description: '업무 설명' })
    description: string;
}

export class ResumeSkillDto {
    @ApiProperty({ description: '스킬 ID' })
    skillId: number;

    @ApiProperty({ description: '스킬명' })
    skillName: string;
}

export class ResumeEducationDto {
    @ApiProperty({ description: '학력 ID' })
    educationId: number;

    @ApiProperty({ description: '학교명' })
    schoolName: string;

    @ApiProperty({ description: '전공' })
    major: string;

    @ApiProperty({ description: '학위' })
    degree: string;

    @ApiProperty({ description: '입학일', nullable: true })
    startDate: Date | null;

    @ApiProperty({ description: '졸업일', nullable: true })
    endDate: Date | null;

    @ApiProperty({ description: '재학 중 여부' })
    isCurrent: boolean;
}

export class ResumeDetailResponseDto {
    @ApiProperty({ description: '이력서 ID' })
    resumeId: number;

    @ApiProperty({ description: '사용자 ID' })
    userId: number;

    @ApiProperty({ description: '이력서 제목' })
    title: string;

    @ApiProperty({ description: '생성일' })
    createdAt: Date;

    @ApiProperty({ description: '수정일' })
    updatedAt: Date;

    @ApiProperty({ description: '경력 목록', type: [ResumeCareerDto] })
    careers: ResumeCareerDto[];

    @ApiProperty({ description: '스킬 목록', type: [ResumeSkillDto] })
    skills: ResumeSkillDto[];

    @ApiProperty({ description: '학력 목록', type: [ResumeEducationDto] })
    educations: ResumeEducationDto[];

    @ApiProperty({ description: '경험/활동 목록' })
    experiences: any[];

    @ApiProperty({ description: '자기소개서 목록' })
    coverletters: any[];

    @ApiProperty({ description: '포트폴리오 목록' })
    portfolios: any[];
}
