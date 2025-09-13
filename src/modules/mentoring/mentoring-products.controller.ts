import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Param,
    Post,
    Query,
    Req,
} from '@nestjs/common';
import { MentoringService } from './mentoring.service';
import { MentoringProductDto } from './dto/product.dto';
import { MentoringProductSlotsDto } from './dto/product-slots.dto';
import { ProductRegularSlotsResponseDto } from './dto/product-regular-slots.dto';
import { ApplicationResponseDto, CreateApplicationDto } from './dto/application.dto';
import { MentoringProductReviewsDto } from './dto/product-reviews.dto';
import { CreateProductReviewDto, ProductReviewResponseDto } from './dto/product-review.dto';
import {
    CreateMentoringProductDto,
    MentoringProductCreatedResponseDto,
} from './dto/product-create.dto';

@Controller('mentoring-products')
export class MentoringProductsController {
    constructor(private readonly svc: MentoringService) {}

    @Post()
    async createProduct(
        @Body() body: CreateMentoringProductDto,
    ): Promise<MentoringProductCreatedResponseDto> {
        return await this.svc.createProduct(body);
    }

    @Get(':product_idx')
    async getProduct(@Param('product_idx') productIdx: string): Promise<MentoringProductDto> {
        return await this.svc.getProduct(Number(productIdx));
    }

    @Get(':product_idx/slots')
    async getProductSlots(
        @Param('product_idx') productIdx: string,
        @Query('date') date: string,
    ): Promise<MentoringProductSlotsDto> {
        return await this.svc.getProductSlots(Number(productIdx), date);
    }

    @Get(':product_idx/regular-slots')
    async getProductRegularSlots(
        @Param('product_idx') productIdx: string,
    ): Promise<ProductRegularSlotsResponseDto> {
        return await this.svc.getProductRegularSlots(Number(productIdx));
    }

    @Post(':product_idx/applications')
    async createApplication(
        @Param('product_idx') productIdx: string,
        @Body() body: CreateApplicationDto,
        @Req() req: any,
    ): Promise<ApplicationResponseDto> {
        // 우선순위: body.mentee_idx -> body.user_idx -> 세션(req.user_idx or req.user.idx)
        const bodyMentee = (body as any)?.mentee_idx ?? (body as any)?.user_idx;
        const sessionMentee = (req && (req.user_idx ?? req.user?.idx)) as number | undefined;
        const menteeIdx = Number(
            bodyMentee !== undefined && bodyMentee !== null
                ? bodyMentee
                : sessionMentee && Number(sessionMentee) > 0
                  ? sessionMentee
                  : NaN,
        );
        if (!menteeIdx || Number.isNaN(menteeIdx)) {
            throw new BadRequestException(
                '멘티 식별자를 확인할 수 없습니다. 로그인하거나 body에 mentee_idx(또는 user_idx)를 넣어주세요.',
            );
        }
        return await this.svc.createApplication(Number(productIdx), body, menteeIdx);
    }

    @Get(':product_idx/reviews')
    async getProductReviews(
        @Param('product_idx') productIdx: string,
        @Query('limit') limit?: string,
        @Query('cursor') cursor?: string,
    ): Promise<MentoringProductReviewsDto> {
        const lim = limit ? Number(limit) : undefined;
        return await this.svc.getProductReviews(Number(productIdx), lim ?? 10, cursor);
    }

    @Post(':product_idx/reviews')
    async createProductReview(
        @Param('product_idx') productIdx: string,
        @Body() body: CreateProductReviewDto,
    ): Promise<ProductReviewResponseDto> {
        return await this.svc.createProductReview(Number(productIdx), body);
    }
}
