export class MentoringProductListItemDto {
    product_idx: number;
    title: string;
    mentor: {
        nickname: string;
        profile: string;
        profile_img: string;
        info: string[];
    };
    rating: number;
    participants: number;
    price: number;
}

export class MentoringProductListResponseDto {
    products: MentoringProductListItemDto[];
    next_cursor?: string;
    has_more: boolean;
    total_count: number;
}

export class MentoringProductListQueryDto {
    cursor?: string;
}
