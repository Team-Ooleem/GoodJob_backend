import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length } from 'class-validator';

export class SpeakSyncDto {
    @IsString()
    @Length(1, 2000)
    text!: string;

    @IsString()
    avatarId!: string;

    @IsOptional()
    @IsInt()
    @IsIn([256, 512] as const)
    resolution?: 256 | 512;

    @IsOptional()
    @IsBoolean()
    stillMode?: boolean;

    @IsOptional()
    @IsBoolean()
    enhance?: boolean;

    @IsOptional()
    @IsObject()
    tts?: {
        engine?: 'google' | 'edge' | 'piper';
        voiceName?: string;
        rate?: number;
    };
}
