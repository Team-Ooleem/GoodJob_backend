import { Controller, Get, Query } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Controller('users')
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
}
