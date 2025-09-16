export class MentorScopedProductMentorDto {
    mentor_idx: number;
    mentor_name: string;
    business_name: string;
    job_category: string;
}

export class MentorScopedProductProductDto {
    product_idx: number;
    title: string;
    description: string;
    job_category: string;
    price: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export class MentorScopedProductResponseDto {
    mentor: MentorScopedProductMentorDto;
    product: MentorScopedProductProductDto;
}

