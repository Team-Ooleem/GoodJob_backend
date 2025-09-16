import { IsString } from 'class-validator';

export class UploadCanvasDto {
    @IsString()
    dataUrl: string;

    @IsString()
    fileName: string;
}

