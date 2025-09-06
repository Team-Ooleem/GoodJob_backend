import { Controller, Get, Query, Post, Body, Req, HttpException, HttpStatus } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { z } from 'zod';
import type { Request } from 'express';

interface AuthenticatedRequest extends Request {
    user_idx: number;
}

// 직군/직무 선호도 저장 요청 스키마
const JobPreferenceSchema = z.object({
    categoryId: z.number().int().positive('직군 ID는 양수여야 합니다'),
    roleId: z.number().int().positive('직무 ID는 양수여야 합니다'),
});

// 희망 근무지 선호도 저장 요청 스키마
const LocationPreferenceSchema = z.object({
    sidoCode: z.string().length(2, '시도 코드는 2자리여야 합니다'),
    guCode: z.string().length(5, '구/군 코드는 5자리여야 합니다'),
});

// 희망 연봉 선호도 저장 요청 스키마
const SalaryPreferenceSchema = z.object({
    salaryRangeId: z.number().int().positive('연봉 구간 ID는 양수여야 합니다'),
});

@Controller('user')
export class UsersController {
    constructor(private readonly databaseService: DatabaseService) {}

    @Get()
    async getUsers(
        @Query('sortBy') sortBy?: string,
        @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
    ) {
        try {
            const sql = 'SELECT * FROM users';
            const users = await this.databaseService.queryWithSort(
                sql,
                [],
                sortBy || 'created_at',
                sortOrder || 'DESC',
            );

            return {
                success: true,
                data: users,
                message: '사용자 목록을 성공적으로 조회했습니다.',
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                message: '사용자 목록 조회에 실패했습니다.',
            };
        }
    }

    /**
     * 사용자 직군/직무 선호도 저장
     * POST /user/job-preference
     */
    @Post('job-preference')
    async saveUserJobPreference(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
        try {
            // 요청 데이터 유효성 검사
            const parsed = JobPreferenceSchema.safeParse(body);
            if (!parsed.success) {
                throw new HttpException(
                    {
                        success: false,
                        error: '유효하지 않은 요청 데이터입니다.',
                        details: parsed.error.flatten(),
                    },
                    HttpStatus.BAD_REQUEST,
                );
            }

            const { categoryId, roleId } = parsed.data;
            const userId = req.user_idx;

            if (!userId) {
                throw new HttpException(
                    {
                        success: false,
                        error: '사용자 인증이 필요합니다.',
                    },
                    HttpStatus.UNAUTHORIZED,
                );
            }

            // 직무가 해당 직군에 속하는지 확인
            const roleValidationQuery = `
                SELECT id FROM job_role 
                WHERE id = ? AND category_id = ?
            `;
            const roleValidation = await this.databaseService.query(roleValidationQuery, [
                roleId,
                categoryId,
            ]);

            if (roleValidation.length === 0) {
                throw new HttpException(
                    {
                        success: false,
                        error: '선택한 직무가 해당 직군에 속하지 않습니다.',
                    },
                    HttpStatus.BAD_REQUEST,
                );
            }

            // individual_profile 테이블에 저장 (UPSERT)
            // 임시로 기본값 사용 (서울특별시, 강남구, 기본 연봉)
            const upsertQuery = `
                INSERT INTO individual_profile (user_idx, desired_job, desired_sido, desired_gu, desired_salary)
                VALUES (?, ?, '11', '11680', 1)
                ON DUPLICATE KEY UPDATE 
                    desired_job = VALUES(desired_job)
            `;

            await this.databaseService.query(upsertQuery, [userId, roleId]);

            return {
                success: true,
                message: '직군/직무 선호도가 성공적으로 저장되었습니다.',
                data: {
                    userId,
                    categoryId,
                    roleId,
                },
            };
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }

            console.error('직군/직무 선호도 저장 오류:', error);
            throw new HttpException(
                {
                    success: false,
                    error: '직군/직무 선호도 저장에 실패했습니다.',
                },
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    /**
     * 사용자 희망 근무지 선호도 저장
     * POST /user/location-preference
     */
    @Post('location-preference')
    async saveUserLocationPreference(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
        try {
            // 요청 데이터 유효성 검사
            const parsed = LocationPreferenceSchema.safeParse(body);
            if (!parsed.success) {
                throw new HttpException(
                    {
                        success: false,
                        error: '유효하지 않은 요청 데이터입니다.',
                        details: parsed.error.flatten(),
                    },
                    HttpStatus.BAD_REQUEST,
                );
            }

            const { sidoCode, guCode } = parsed.data;
            const userId = req.user_idx;

            if (!userId) {
                throw new HttpException(
                    {
                        success: false,
                        error: '사용자 인증이 필요합니다.',
                    },
                    HttpStatus.UNAUTHORIZED,
                );
            }

            // 시도 코드 유효성 검사
            const sidoValidationQuery = `
                SELECT sido_code FROM sido WHERE sido_code = ?
            `;
            const sidoValidation = await this.databaseService.query(sidoValidationQuery, [
                sidoCode,
            ]);

            if (sidoValidation.length === 0) {
                throw new HttpException(
                    {
                        success: false,
                        error: '유효하지 않은 시도 코드입니다.',
                    },
                    HttpStatus.BAD_REQUEST,
                );
            }

            // 구/군 코드 유효성 검사 (해당 시도에 속하는지 확인)
            const guValidationQuery = `
                SELECT gu_code FROM gu WHERE gu_code = ? AND sido_code = ?
            `;
            const guValidation = await this.databaseService.query(guValidationQuery, [
                guCode,
                sidoCode,
            ]);

            if (guValidation.length === 0) {
                throw new HttpException(
                    {
                        success: false,
                        error: '선택한 구/군이 해당 시도에 속하지 않습니다.',
                    },
                    HttpStatus.BAD_REQUEST,
                );
            }

            // individual_profile 테이블에 희망 근무지 업데이트
            const updateQuery = `
                UPDATE individual_profile 
                SET desired_sido = ?, desired_gu = ?
                WHERE user_idx = ?
            `;

            await this.databaseService.query(updateQuery, [sidoCode, guCode, userId]);

            return {
                success: true,
                message: '희망 근무지 선호도가 성공적으로 저장되었습니다.',
                data: {
                    userId,
                    sidoCode,
                    guCode,
                },
            };
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }

            console.error('희망 근무지 선호도 저장 오류:', error);
            throw new HttpException(
                {
                    success: false,
                    error: '희망 근무지 선호도 저장에 실패했습니다.',
                },
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    /**
     * 사용자 희망 연봉 선호도 저장
     * POST /user/salary-preference
     */
    @Post('salary-preference')
    async saveUserSalaryPreference(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
        try {
            // 요청 데이터 유효성 검사
            const parsed = SalaryPreferenceSchema.safeParse(body);
            if (!parsed.success) {
                throw new HttpException(
                    {
                        success: false,
                        error: '유효하지 않은 요청 데이터입니다.',
                        details: parsed.error.flatten(),
                    },
                    HttpStatus.BAD_REQUEST,
                );
            }

            const { salaryRangeId } = parsed.data;
            const userId = req.user_idx;

            if (!userId) {
                throw new HttpException(
                    {
                        success: false,
                        error: '인증이 필요합니다.',
                    },
                    HttpStatus.UNAUTHORIZED,
                );
            }

            // 연봉 구간 존재 여부 확인
            const salaryCheckQuery = `
                SELECT idx FROM salary_range 
                WHERE idx = ?
            `;
            const salaryExists = await this.databaseService.query(salaryCheckQuery, [
                salaryRangeId,
            ]);

            if (salaryExists.length === 0) {
                throw new HttpException(
                    {
                        success: false,
                        error: '존재하지 않는 연봉 구간입니다.',
                    },
                    HttpStatus.BAD_REQUEST,
                );
            }

            // individual_profile 테이블에 저장 (UPSERT)
            // 임시로 기본값 사용 (서울특별시, 강남구, 기본 직무)
            const upsertQuery = `
                INSERT INTO individual_profile (user_idx, desired_job, desired_sido, desired_gu, desired_salary)
                VALUES (?, 1, '11', '11680', ?)
                ON DUPLICATE KEY UPDATE 
                    desired_salary = VALUES(desired_salary)
            `;

            await this.databaseService.query(upsertQuery, [userId, salaryRangeId]);

            return {
                success: true,
                message: '희망 연봉 선호도가 성공적으로 저장되었습니다.',
                data: {
                    userId,
                    salaryRangeId,
                },
            };
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }

            console.error('Error saving salary preference:', error);
            throw new HttpException(
                {
                    success: false,
                    error: '희망 연봉 선호도 저장 중 오류가 발생했습니다.',
                },
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }
}
