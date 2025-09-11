import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { MentoringService } from './mentoring.service';
import { MentoringProductDto } from './dto/product.dto';
import { MentoringProductSlotsDto } from './dto/product-slots.dto';
import { ApplicationResponseDto, CreateApplicationDto } from './dto/application.dto';
import { MentoringProductReviewsDto } from './dto/product-reviews.dto';

@Controller('mentoring-products')
export class MentoringProductsController {
    constructor(private readonly svc: MentoringService) {}

    @Get(':product_idx')
    getProduct(@Param('product_idx') productIdx: string): MentoringProductDto {
        return this.svc.getProduct(Number(productIdx));
    }

    @Get(':product_idx/slots')
    getProductSlots(@Param('product_idx') productIdx: string): MentoringProductSlotsDto {
        return this.svc.getProductSlots(Number(productIdx));
    }

    @Post(':product_idx/applications')
    createApplication(
        @Param('product_idx') productIdx: string,
        @Body() body: CreateApplicationDto,
    ): ApplicationResponseDto {
        return this.svc.createApplication(Number(productIdx), body);
    }

    @Get(':product_idx/reviews')
    getProductReviews(
        @Param('product_idx') productIdx: string,
        @Query('limit') limit?: string,
        @Query('cursor') cursor?: string,
    ): MentoringProductReviewsDto {
        const lim = limit ? Number(limit) : undefined;
        return this.svc.getProductReviews(Number(productIdx), lim ?? 10, cursor);
    }
}
