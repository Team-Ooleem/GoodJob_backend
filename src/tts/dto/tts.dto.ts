import { IsString, IsOptional, IsNumber, IsIn } from 'class-validator';

export class SynthesizeSpeechDto {
    @IsString()
    text: string;

    @IsOptional()
    @IsString()
    @IsIn(['ko-KR', 'en-US', 'ja-JP'])
    languageCode?: string = 'ko-KR';

    @IsOptional()
    @IsString()
    @IsIn([
        'ko-KR-Standard-A',
        'ko-KR-Standard-B',
        'ko-KR-Standard-C',
        'ko-KR-Standard-D',
        'ko-KR-Wavenet-A',
        'ko-KR-Wavenet-B',
        'ko-KR-Wavenet-C',
        'ko-KR-Wavenet-D',
    ])
    voiceName?: string = 'ko-KR-Standard-A';

    @IsOptional()
    @IsString()
    @IsIn(['MP3', 'LINEAR16', 'OGG_OPUS'])
    audioEncoding?: string = 'MP3';

    @IsOptional()
    @IsNumber()
    speakingRate?: number = 1.0;

    @IsOptional()
    @IsNumber()
    pitch?: number = 0.0;
}
