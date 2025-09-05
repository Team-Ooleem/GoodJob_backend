import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
    constructor(private readonly jobsService: JobsService) {}

    // 직군 카테고리 목록
    @Get('categories')
    async getJobCategories() {
        const categories = await this.jobsService.getJobCategories();
        return {
            success: true,
            data: {
                categories: categories.map((cat) => ({
                    id: cat.id,
                    name: cat.name,
                })),
            },
        };
    }

    // 특정 직군의 직무 목록
    @Get('roles/:categoryId')
    async getJobRolesByCategory(@Param('categoryId', ParseIntPipe) categoryId: number) {
        const roles = await this.jobsService.getJobRolesByCategory(categoryId);
        return {
            success: true,
            data: {
                roles: roles.map((role) => ({
                    id: role.id,
                    name: role.name,
                })),
            },
        };
    }
}
