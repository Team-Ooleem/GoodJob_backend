import { Controller, Get, Param, Query } from '@nestjs/common';
import { MentoringService } from './mentoring.service';
import { MentorReviewsResponseDto } from './dto/mentor-reviews.dto';

@Controller('mentors')
export class MentorsController {
    constructor(private readonly svc: MentoringService) {}

    @Get(':mentor_idx/reviews')
    async getMentorReviews(
        @Param('mentor_idx') mentorIdx: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ): Promise<MentorReviewsResponseDto> {
        const p = page ? Number(page) : 1;
        const l = limit ? Number(limit) : 20;
        return await this.svc.getMentorReviews(Number(mentorIdx), p, l);
    }
}
