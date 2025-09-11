export class CreateMentoringProductSlotDto {
    regular_slots_idx: number;
    day_of_week: number; // 1-7
    hour_slot: number; // 0-23
}

export class CreateMentoringProductDto {
    product_idx: number;
    mentor_idx: number;
    title: string;
    job_category_id: number;
    description: string;
    price: number;
    is_active: boolean;
    slots: CreateMentoringProductSlotDto[];
    created_at: string; // ISO string
}

export class MentoringProductCreatedSlotDto {
    day_of_week: number;
    hour_slot: number;
}

export class MentoringProductCreatedResponseDto {
    mentor_idx: number;
    title: string;
    job_category_id: number;
    description: string;
    price: number;
    slots: MentoringProductCreatedSlotDto[];
}

