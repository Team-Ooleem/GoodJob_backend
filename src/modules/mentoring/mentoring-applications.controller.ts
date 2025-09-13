import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { MentoringService } from './mentoring.service';
import { MentoringApplicationsResponseDto } from './dto/mentoring-applications.dto';
import {
    UpdateApplicationStatusDto,
    UpdateApplicationStatusResponseDto,
} from './dto/application-update.dto';

@Controller('mentoring-applications')
export class MentoringApplicationsController {
    constructor(private readonly svc: MentoringService) {}

    @Get(':user_idx')
    async getApplications(
        @Param('user_idx') userIdx: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ): Promise<MentoringApplicationsResponseDto> {
        const p = page ? Number(page) : 1;
        const l = limit ? Number(limit) : 10;
        return await this.svc.getMentoringApplications(Number(userIdx), p, l);
    }

    @Patch(':application_id')
    async updateStatus(
        @Param('application_id') applicationId: string,
        @Body() body: UpdateApplicationStatusDto,
    ): Promise<UpdateApplicationStatusResponseDto> {
        return await this.svc.updateApplicationStatus(Number(applicationId), body);
    }
}
