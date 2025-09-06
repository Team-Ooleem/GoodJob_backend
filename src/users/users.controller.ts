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
}
