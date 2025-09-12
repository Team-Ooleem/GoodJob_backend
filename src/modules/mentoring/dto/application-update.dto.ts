export type ApplicationStatus =
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'cancelled'
    | 'completed';

export class UpdateApplicationStatusDto {
    application_status: ApplicationStatus;
    rejection_reason?: string;
}

export class UpdateApplicationStatusResponseDto {
    application_id: number;
    application_status: ApplicationStatus;
    rejection_reason?: string;
    updated_at: string; // ISO string
}

