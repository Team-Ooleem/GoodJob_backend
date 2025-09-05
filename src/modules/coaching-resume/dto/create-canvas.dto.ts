import { IsOptional, IsString, IsInt } from 'class-validator';

export class CreateCanvasDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsInt()
    participantId: number; // 같이 들어올 다른 사람의 userId
}
