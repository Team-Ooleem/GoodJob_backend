import { Controller, Get, Param, Query } from '@nestjs/common';
import { MentoringService } from './mentoring.service';
import { MentorReviewsResponseDto } from './dto/mentor-reviews.dto';
import { MentorProductsResponseDto } from './dto/mentor-products.dto';
import { MentorScopedProductResponseDto } from './dto/mentor-product.dto';

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

    @Get(':mentor_idx/mentoring-products')
    async getMentorProducts(
        @Param('mentor_idx') mentorIdx: string,
    ): Promise<MentorProductsResponseDto> {
        return await this.svc.getMentorProducts(Number(mentorIdx));
    }

    @Get(':mentor_idx/mentoring-products/:product_idx')
    async getMentorProduct(
        @Param('mentor_idx') mentorIdx: string,
        @Param('product_idx') productIdx: string,
    ): Promise<MentorScopedProductResponseDto> {
        return await this.svc.getMentorProduct(Number(mentorIdx), Number(productIdx));
    }
}
