export class MentorProductItemDto {
    product_idx: number;
    title: string;
    job_category: string;
    price: number;
    is_active: boolean;
    created_at: string;
}

export class MentorProductsResponseDto {
    mentor_idx: number;
    mentor_name: string;
    products: MentorProductItemDto[];
}

