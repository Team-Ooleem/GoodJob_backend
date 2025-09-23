export class MentorDto {
    name: string;
    profile_img: string | null; // users 테이블의 profile_img
    job_category: string;
    career: string; // e.g., '5년차'
    business_name: string; // e.g., 회사명
}

export class MyMentorIdxResponseDto {
    mentor_idx: number | null;
    is_mentor: boolean;
}
