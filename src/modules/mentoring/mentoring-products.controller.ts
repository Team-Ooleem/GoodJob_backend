import { Controller, Get, Param } from '@nestjs/common';
import { MentoringService } from './mentoring.service';
import { MentoringProductDto } from './dto/product.dto';

@Controller('mentoring-products')
export class MentoringProductsController {
    constructor(private readonly svc: MentoringService) {}

    @Get(':product_idx')
    getProduct(@Param('product_idx') productIdx: string): MentoringProductDto {
        return this.svc.getProduct(Number(productIdx));
    }
}

