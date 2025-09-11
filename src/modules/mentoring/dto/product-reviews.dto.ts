export class MentoringProductReviewDto {
    review_idx: number;
    mentee_name: string;
    rating: number;
    review_content: string;
    created_at: string; // ISO string
}

export class MentoringProductReviewsPageInfoDto {
    next_cursor: string | null;
    has_more: boolean;
}

export class MentoringProductReviewsDto {
    product_idx: number;
    average_rating: number;
    review_count: number;
    reviews: MentoringProductReviewDto[];
    page_info: MentoringProductReviewsPageInfoDto;
}

