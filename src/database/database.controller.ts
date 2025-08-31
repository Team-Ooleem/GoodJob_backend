import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from './database.service';

@Controller('database')
export class DatabaseController {
    constructor(private readonly databaseService: DatabaseService) {}

    @Get('health')
    async getHealth() {
        const isHealthy = await this.databaseService.healthCheck();
        return {
            status: isHealthy ? 'healthy' : 'unhealthy',
            timestamp: new Date().toISOString(),
            message: isHealthy
                ? '데이터베이스 연결이 정상입니다.'
                : '데이터베이스 연결에 문제가 있습니다.',
        };
    }

    @Get('test-query')
    async testQuery() {
        try {
            const result = await this.databaseService.query('SELECT 1 as test');
            return {
                success: true,
                result,
                message: '테스트 쿼리가 성공적으로 실행되었습니다.',
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                message: '테스트 쿼리 실행에 실패했습니다.',
            };
        }
    }
}
