import { Injectable } from '@nestjs/common';
import { MentoringProductDto } from './dto/product.dto';

@Injectable()
export class MentoringService {
    getProduct(productIdx: number): MentoringProductDto {
        return {
            product_idx: productIdx,
            title: '프론트엔드 면접 대비 1:1 멘토링',
            description: '실제 면접 경험 기반으로 포트폴리오와 코딩테스트 준비를 도와드립니다.',
            price: 50000,
            job_category: '프론트엔드 개발',

            mentee_count: 8,
            review_count: 12,
            average_rating: 4.8,

            mentor: {
                name: '홍길동',
                job_category: '프론트엔드 개발',
                career: '5년차',
                business_name: '네이버',
            },
        };
    }
}
