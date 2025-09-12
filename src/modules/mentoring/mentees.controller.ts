import { Controller, Get, Param } from '@nestjs/common';
import { MentoringService } from './mentoring.service';
import { MenteeApplicationsResponseDto } from './dto/mentee-applications.dto';

@Controller('mentees')
export class MenteesController {
    constructor(private readonly svc: MentoringService) {}

    @Get(':mentee_idx/applications')
    getMenteeApplications(@Param('mentee_idx') menteeIdx: string): MenteeApplicationsResponseDto {
        return this.svc.getMenteeApplications(Number(menteeIdx));
    }
}
