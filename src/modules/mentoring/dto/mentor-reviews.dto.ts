export class MentorReviewsPageInfoDto {
    page: number;
    limit: number;
    total_pages: number;
    has_next: boolean;
}

export class MentorReviewMenteeDto {
    user_idx: number;
    name: string;
    profile_img: string;
}

export class MentorReviewItemDto {
    review_idx: number;
    product_idx: number;
    product_title: string;
    mentee: MentorReviewMenteeDto;
    rating: number;
    review_content: string;
    created_at: string; // ISO string
}

export class MentorReviewsResponseDto {
    mentor_idx: number;
    review_count: number;
    average_rating: number;
    page_info: MentorReviewsPageInfoDto;
    reviews: MentorReviewItemDto[];
}

