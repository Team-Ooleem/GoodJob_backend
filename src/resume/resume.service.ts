import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateResumeDto } from './dto/create-resume.dto';
import { UpdateResumeDto } from './dto/update-resume.dto';
import { ResumeListResponseDto } from './dto/resume-list-response.dto';
import { ResumeDetailResponseDto } from './dto/resume-detail-response.dto';
import {
    Resume,
    ResumeCareer,
    ResumeSkill,
    ResumeEducation,
    ResumeWithDetails,
} from './interfaces/resume.interface';

@Injectable()
export class ResumeService {
    constructor(private readonly databaseService: DatabaseService) {}

    async create(createResumeDto: CreateResumeDto, userId: number): Promise<Resume> {
        try {
            const sql = `
        INSERT INTO resume (user_id, title, created_at, updated_at) 
        VALUES (?, ?, NOW(), NOW())
      `;

            await this.databaseService.query(sql, [userId, createResumeDto.title]);

            // 생성된 이력서 조회
            const selectSql = `
        SELECT * FROM resume 
        WHERE user_id = ? AND title = ? 
        ORDER BY created_at DESC 
        LIMIT 1
      `;

            const resume = await this.databaseService.queryOne<Resume>(selectSql, [
                userId,
                createResumeDto.title,
            ]);

            if (!resume) {
                throw new BadRequestException('이력서 생성에 실패했습니다.');
            }

            return resume;
        } catch (error) {
            throw new BadRequestException('이력서 생성에 실패했습니다.');
        }
    }

    async findByUserId(userId: number): Promise<ResumeListResponseDto[]> {
        try {
            const sql = `
        SELECT 
          r.resume_id,
          r.title,
          r.created_at,
          r.updated_at,
          GROUP_CONCAT(DISTINCT rc.company_name ORDER BY rc.start_date DESC) as companies,
          GROUP_CONCAT(DISTINCT rc.position ORDER BY rc.start_date DESC) as positions,
          GROUP_CONCAT(DISTINCT rs.skill_name) as skills
        FROM resume r
        LEFT JOIN resume_career rc ON r.resume_id = rc.resume_id
        LEFT JOIN resume_skill rs ON r.resume_id = rs.resume_id
        WHERE r.user_id = ?
        GROUP BY r.resume_id
        ORDER BY r.updated_at DESC
      `;

            const resumes = await this.databaseService.query(sql, [userId]);

            return resumes.map((resume) => this.transformToListResponse(resume));
        } catch (error) {
            throw new BadRequestException('이력서 목록 조회에 실패했습니다.');
        }
    }

    async findOne(id: number): Promise<ResumeDetailResponseDto> {
        try {
            // 기본 이력서 정보 조회
            const resumeSql = `SELECT * FROM resume WHERE resume_id = ?`;
            const resume = await this.databaseService.queryOne<Resume>(resumeSql, [id]);

            if (!resume) {
                throw new NotFoundException('이력서를 찾을 수 없습니다.');
            }

            // 경력 정보 조회
            const careerSql = `
        SELECT * FROM resume_career 
        WHERE resume_id = ? 
        ORDER BY start_date DESC
      `;
            const careers = await this.databaseService.query<ResumeCareer>(careerSql, [id]);

            // 스킬 정보 조회
            const skillSql = `SELECT * FROM resume_skill WHERE resume_id = ?`;
            const skills = await this.databaseService.query<ResumeSkill>(skillSql, [id]);

            // 학력 정보 조회
            const educationSql = `
        SELECT * FROM resume_education 
        WHERE resume_id = ? 
        ORDER BY start_date DESC
      `;
            const educations = await this.databaseService.query<ResumeEducation>(educationSql, [
                id,
            ]);

            // 경험/활동 정보 조회
            const experienceSql = `
        SELECT * FROM resume_experience 
        WHERE resume_id = ? 
        ORDER BY start_date DESC
      `;
            const experiences = await this.databaseService.query(experienceSql, [id]);

            // 자기소개서 조회
            const coverletterSql = `SELECT * FROM resume_coverletter WHERE resume_id = ?`;
            const coverletters = await this.databaseService.query(coverletterSql, [id]);

            // 포트폴리오 조회
            const portfolioSql = `SELECT * FROM resume_portfolio WHERE resume_id = ?`;
            const portfolios = await this.databaseService.query(portfolioSql, [id]);

            return {
                resumeId: resume.resume_id,
                userId: resume.user_id,
                title: resume.title,
                createdAt: resume.created_at,
                updatedAt: resume.updated_at,
                careers: careers.map((career) => ({
                    careerId: career.career_id,
                    companyName: career.company_name,
                    position: career.position,
                    isCurrent: !!career.is_current,
                    startDate: career.start_date,
                    endDate: career.end_date,
                    description: career.description ?? '',
                })),
                skills: skills.map((skill) => ({
                    skillId: skill.skill_id,
                    skillName: skill.skill_name,
                })),
                educations: educations.map((education) => ({
                    educationId: education.education_id,
                    schoolName: education.school_name,
                    major: education.major,
                    degree: education.degree,
                    startDate: education.start_date,
                    endDate: education.end_date,
                    isCurrent: !!education.is_current,
                })),
                experiences: experiences.map((experience) => ({
                    experienceId: experience.experience_id,
                    experienceName: experience.experience_name,
                    startDate: experience.start_date,
                    endDate: experience.end_date,
                    description: experience.description,
                })),
                coverletters: coverletters.map((coverletter) => ({
                    coverletterId: coverletter.coverletter_id,
                    coverletterTitle: coverletter.coverletter_title,
                    description: coverletter.description,
                })),
                portfolios: portfolios.map((portfolio) => ({
                    portfolioId: portfolio.portfolio_id,
                    link: portfolio.link,
                })),
            };
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new BadRequestException('이력서 조회에 실패했습니다.');
        }
    }

    async update(id: number, updateResumeDto: UpdateResumeDto, userId: number): Promise<Resume> {
        try {
            // 이력서 소유권 확인
            const checkSql = `SELECT user_id FROM resume WHERE resume_id = ?`;
            const resume = await this.databaseService.queryOne<{ user_id: number }>(checkSql, [id]);

            if (!resume) {
                throw new NotFoundException('이력서를 찾을 수 없습니다.');
            }

            if (resume.user_id !== userId) {
                throw new ForbiddenException('이력서를 수정할 권한이 없습니다.');
            }

            // 이력서 업데이트
            const updateSql = `
        UPDATE resume 
        SET title = ?, updated_at = NOW() 
        WHERE resume_id = ?
      `;

            await this.databaseService.query(updateSql, [updateResumeDto.title, id]);

            // 업데이트된 이력서 조회
            const selectSql = `SELECT * FROM resume WHERE resume_id = ?`;
            const updatedResume = await this.databaseService.queryOne<Resume>(selectSql, [id]);
            if (!updatedResume) {
                throw new NotFoundException('이력서를 찾을 수 없습니다.');
            }

            return updatedResume;
        } catch (error) {
            if (error instanceof NotFoundException || error instanceof ForbiddenException) {
                throw error;
            }
            throw new BadRequestException('이력서 수정에 실패했습니다.');
        }
    }

    async remove(id: number, userId: number): Promise<void> {
        try {
            // 이력서 소유권 확인
            const checkSql = `SELECT user_id FROM resume WHERE resume_id = ?`;
            const resume = await this.databaseService.queryOne<{ user_id: number }>(checkSql, [id]);

            if (!resume) {
                throw new NotFoundException('이력서를 찾을 수 없습니다.');
            }

            if (resume.user_id !== userId) {
                throw new ForbiddenException('이력서를 삭제할 권한이 없습니다.');
            }

            // 트랜잭션으로 관련 데이터 모두 삭제
            await this.databaseService.transaction(async (connection) => {
                // 관련 테이블들 삭제 (외래키 제약조건으로 자동 삭제되지만 명시적으로)
                await connection.execute('DELETE FROM resume_career WHERE resume_id = ?', [id]);
                await connection.execute('DELETE FROM resume_skill WHERE resume_id = ?', [id]);
                await connection.execute('DELETE FROM resume_education WHERE resume_id = ?', [id]);
                await connection.execute('DELETE FROM resume_experience WHERE resume_id = ?', [id]);
                await connection.execute('DELETE FROM resume_coverletter WHERE resume_id = ?', [
                    id,
                ]);
                await connection.execute('DELETE FROM resume_portfolio WHERE resume_id = ?', [id]);

                // 이력서 삭제
                await connection.execute('DELETE FROM resume WHERE resume_id = ?', [id]);
            });
        } catch (error) {
            if (error instanceof NotFoundException || error instanceof ForbiddenException) {
                throw error;
            }
            throw new BadRequestException('이력서 삭제에 실패했습니다.');
        }
    }

    private transformToListResponse(resume: any): ResumeListResponseDto {
        // 가장 최근 경력 정보 가져오기
        const companies = resume.companies ? resume.companies.split(',') : [];
        const positions = resume.positions ? resume.positions.split(',') : [];

        // 총 경력 계산
        const totalExperience = this.calculateExperienceFromCompanies(companies);

        // 스킬 목록
        const skills = resume.skills ? resume.skills.split(',') : [];

        return {
            id: resume.resume_id,
            title: resume.title,
            position: positions[0] || '미정',
            company: companies[0] || '미정',
            createdAt: new Date(resume.created_at).toISOString().split('T')[0],
            experience: totalExperience,
            skills: skills,
        };
    }

    private calculateExperienceFromCompanies(companies: string[]): string {
        if (!companies || companies.length === 0) {
            return '신입';
        }

        // 간단한 경력 계산 (회사 수 기반)
        // 실제로는 더 정교한 계산이 필요
        const companyCount = companies.length;
        if (companyCount === 1) {
            return '1-2년';
        } else if (companyCount === 2) {
            return '3-5년';
        } else {
            return `${companyCount * 2}년+`;
        }
    }
}
