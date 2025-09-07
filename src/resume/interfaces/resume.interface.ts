// interfaces/resume.interface.ts
export interface Resume {
    resume_id: number;
    user_id: number;
    title: string;
    created_at: Date;
    updated_at: Date;
}

export interface ResumeCareer {
    career_id: number;
    resume_id: number;
    company_name: string;
    position: string;
    is_current: boolean;
    start_date: Date | null;
    end_date: Date | null;
    description: string | null;
}

export interface ResumeSkill {
    skill_id: number;
    resume_id: number;
    skill_name: string;
}

export interface ResumeEducation {
    education_id: number;
    resume_id: number;
    school_name: string;
    major: string;
    degree: string;
    start_date: Date | null;
    end_date: Date | null;
    is_current: boolean;
}

export interface ResumeExperience {
    experience_id: number;
    resume_id: number;
    experience_name: string;
    start_date: Date | null;
    end_date: Date | null;
    description: string | null;
}

export interface ResumeCoverletter {
    coverletter_id: number;
    resume_id: number;
    coverletter_title: string | null;
    description: string | null;
}

export interface ResumePortfolio {
    portfolio_id: number;
    resume_id: number;
    link: string | null;
}

export interface ResumeWithDetails extends Resume {
    careers: ResumeCareer[];
    skills: ResumeSkill[];
    educations: ResumeEducation[];
    experiences: ResumeExperience[];
    coverletters: ResumeCoverletter[];
    portfolios: ResumePortfolio[];
}
