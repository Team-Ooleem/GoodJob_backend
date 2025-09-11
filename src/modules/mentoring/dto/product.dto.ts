import { MentorDto } from './mentor.dto';

export class MentoringProductDto {
    product_idx: number;
    title: string;
    description: string;
    price: number;
    job_category: string;

    mentee_count: number;
    review_count: number;
    average_rating: number;

    mentor: MentorDto;
}

