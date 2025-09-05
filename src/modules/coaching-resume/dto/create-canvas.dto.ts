import { IsOptional, IsString } from 'class-validator';

export class CreateCanvasDto {
    @IsOptional()
    @IsString()
    name?: string;
}
