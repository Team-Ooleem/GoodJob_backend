export class ProductRegularSlotItemDto {
    regular_slots_idx: number;
    day_of_week: number; // 1-7
    hour_slot: number; // 0-23
    time_range: string; // HH:00-(HH+1):00
}

export class ProductRegularSlotsResponseDto {
    product_idx: number;
    slots: ProductRegularSlotItemDto[];
}
