export class MenteeApplicationItemDto {
    application_id: number;
    product_title: string;
    mentor_name: string;
    booked_date: string; // YYYY-MM-DD
    application_status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed';
}

export class MenteeApplicationsResponseDto {
    applications: MenteeApplicationItemDto[];
}

