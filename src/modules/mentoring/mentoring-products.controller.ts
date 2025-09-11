import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { MentoringService } from './mentoring.service';
import { MentoringProductDto } from './dto/product.dto';
import { MentoringProductSlotsDto } from './dto/product-slots.dto';
import { ApplicationResponseDto, CreateApplicationDto } from './dto/application.dto';
import { MentoringProductReviewsDto } from './dto/product-reviews.dto';
import { CreateProductReviewDto, ProductReviewResponseDto } from './dto/product-review.dto';
import { CreateMentoringProductDto, MentoringProductCreatedResponseDto } from './dto/product-create.dto';

@Controller('mentoring-products')
export class MentoringProductsController {
    constructor(private readonly svc: MentoringService) {}

    @Post()
    createProduct(
        @Body() body: CreateMentoringProductDto,
    ): MentoringProductCreatedResponseDto {
        return this.svc.createProduct(body);
    }

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

    @Post(':product_idx/reviews')
    createProductReview(
        @Param('product_idx') productIdx: string,
        @Body() body: CreateProductReviewDto,
    ): ProductReviewResponseDto {
        return this.svc.createProductReview(Number(productIdx), body);
    }
}
