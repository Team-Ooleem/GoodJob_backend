export class MentoringSlotDto {
    hour_slot: number;
    time_range: string;
    available: boolean;
}

export class MentoringProductSlotsDto {
    date: string; // YYYY-MM-DD
    day_of_week: number; // 1-7
    slots: MentoringSlotDto[];
}

