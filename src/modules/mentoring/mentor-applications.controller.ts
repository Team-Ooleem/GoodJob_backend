import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { MentoringService } from './mentoring.service';
import {
    CreateMentorApplicationDto,
    MentorApplicationCreateResponseDto,
} from './dto/mentor-application.dto';
import { JobCategoryResponseDto } from './dto/job-category.dto';

@Controller('mentor-applications')
export class MentorApplicationsController {
    constructor(private readonly svc: MentoringService) {}

    @Post()
    async createMentorApplication(
        @Body() body: CreateMentorApplicationDto,
        @Req() req: Request,
    ): Promise<MentorApplicationCreateResponseDto> {
        const userIdx = req['user_idx'] as number;
        return await this.svc.createMentorApplication(body, userIdx);
    }

    @Get('job-categories')
    async getJobCategories(): Promise<JobCategoryResponseDto> {
        return await this.svc.getJobCategories();
    }
}
