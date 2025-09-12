export class CreateMentorApplicationDto {
    contact_email: string;
    business_name: string;
    contact_phone: string;
    preferred_field_id: number;
    introduction: string;
    portfolio_link?: string;
}

export class MentorApplicationCreateResponseDto {
    success: boolean;
    message: string;
    mentor_idx?: number;
}
