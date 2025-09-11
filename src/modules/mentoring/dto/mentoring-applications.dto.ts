export class MenteeSummaryDto {
    user_idx: number;
    name: string;
    profile_img: string;
}

export class MentorSummaryDto {
    mentor_idx: number;
    business_name: string;
    job_category: string;
}

export class MentoringApplicationItemDto {
    application_id: number;
    product_idx: number;
    product_title: string;
    booked_date: string; // YYYY-MM-DD
    application_status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed';
    mentee: MenteeSummaryDto;
    mentor: MentorSummaryDto;
}

export class MentoringApplicationsPageInfoDto {
    page: number;
    limit: number;
    total: number;
    has_next: boolean;
}

export class MentoringApplicationsResponseDto {
    applications: MentoringApplicationItemDto[];
    page_info: MentoringApplicationsPageInfoDto;
}

