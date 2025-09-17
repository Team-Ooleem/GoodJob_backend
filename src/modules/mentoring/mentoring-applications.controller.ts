import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import { MentoringService } from './mentoring.service';
import { MentoringApplicationsResponseDto } from './dto/mentoring-applications.dto';
import {
    UpdateApplicationStatusDto,
    UpdateApplicationStatusResponseDto,
} from './dto/application-update.dto';
import { MyMentorIdxResponseDto } from './dto/mentor.dto';

@Controller('mentoring-applications')
export class MentoringApplicationsController {
    constructor(private readonly svc: MentoringService) {}

    @Get('my/mentor-idx')
    async getMyMentorIdx(@Req() req: any): Promise<MyMentorIdxResponseDto> {
        const userIdx = req.user_idx as number;
        console.log(
            `🚀 [MentoringApplicationsController] getMyMentorIdx API 호출됨. userIdx: ${userIdx}`,
        );

        const result = await this.svc.getMyMentorIdx(userIdx);
        console.log(`📤 [MentoringApplicationsController] 최종 응답:`, result);

        return result;
    }

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

    @Get('my/:user_idx')
    async getMyApplications(
        @Param('user_idx') userIdx: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ): Promise<MentoringApplicationsResponseDto> {
        const p = page ? Number(page) : 1;
        const l = limit ? Number(limit) : 10;
        return await this.svc.getMyMentoringApplications(Number(userIdx), p, l);
    }

    @Patch(':application_id')
    async updateStatus(
        @Param('application_id') applicationId: string,
        @Body() body: UpdateApplicationStatusDto,
    ): Promise<UpdateApplicationStatusResponseDto> {
        return await this.svc.updateApplicationStatus(Number(applicationId), body);
    }
}
