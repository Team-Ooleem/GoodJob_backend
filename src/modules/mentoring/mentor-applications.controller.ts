import { Body, Controller, Get, Post } from '@nestjs/common';
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
    ): Promise<MentorApplicationCreateResponseDto> {
        return await this.svc.createMentorApplication(body);
    }

    @Get('job-categories')
    async getJobCategories(): Promise<JobCategoryResponseDto> {
        return await this.svc.getJobCategories();
    }
}
