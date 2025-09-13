export class JobCategoryDto {
    id: number;
    name: string;
}

export class JobCategoryResponseDto {
    categories: JobCategoryDto[];
}
