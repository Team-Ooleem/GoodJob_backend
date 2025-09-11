export class CreateProductReviewDto {
    application_id: number;
    rating: number;
    review_content: string;
}

export class ProductReviewResponseDto {
    review_idx: number;
    product_idx: number;
    application_id: number;
    mentee_idx: number;
    rating: number;
    review_content: string;
    created_at: string; // ISO string
}

