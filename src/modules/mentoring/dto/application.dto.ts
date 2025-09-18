export class PaymentDto {
    amount: number;
    transaction_id: string;
    status: 'pending' | 'completed' | 'failed';
}

export class CreateApplicationDto {
    regular_slots_idx: number;
    booked_date: string; // YYYY-MM-DD
    message_to_mentor: string;
    payment: PaymentDto;
}

export class ApplicationPaymentDto {
    payment_id: number;
    amount: number;
    status: 'pending' | 'completed' | 'failed';
    transaction_id: string;
    paid_at: string; // ISO string
}

export class ApplicationResponseDto {
    application_id: number;
    product_idx: number;
    mentee_idx: number;
    regular_slots_idx: number;
    booked_date: string;
    application_status: 'pending' | 'approved' | 'rejected' | 'cancelled';
    message_to_mentor: string;
    payment: ApplicationPaymentDto;
    created_at: string; // ISO string
    canvas_id?: string;
}
