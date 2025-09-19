import { IsString, IsOptional, IsNumber, IsBoolean, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TranscribeBase64RequestDto {
    @ApiProperty({ description: 'Base64 인코딩된 오디오 데이터' })
    @IsString()
    @IsNotEmpty()
    audioData: string;

    @ApiProperty({ description: '오디오 MIME 타입', required: false, default: 'audio/wav' })
    @IsOptional()
    @IsString()
    mimeType?: string = 'audio/wav';
}

export class TranscribeWithContextRequestDto {
    @ApiProperty({ description: 'Base64 인코딩된 오디오 데이터' })
    @IsString()
    @IsNotEmpty()
    audioData: string;

    @ApiProperty({ description: '오디오 MIME 타입', required: false, default: 'audio/wav' })
    @IsOptional()
    @IsString()
    mimeType?: string = 'audio/wav';

    @ApiProperty({ description: '캔버스 인덱스' })
    @IsNumber()
    canvasIdx: number;

    @ApiProperty({ description: '멘토 인덱스' })
    @IsNumber()
    mentorIdx: number;

    @ApiProperty({ description: '멘티 인덱스' })
    @IsNumber()
    menteeIdx: number;

    @ApiProperty({ description: '오디오 지속 시간', required: false })
    @IsOptional()
    @IsNumber()
    duration?: number;
}

export class TranscribeChunkRequestDto {
    @ApiProperty({ description: 'Base64 인코딩된 오디오 데이터' })
    @IsString()
    @IsNotEmpty()
    audioData: string;

    @ApiProperty({ description: '오디오 MIME 타입', required: false, default: 'audio/wav' })
    @IsOptional()
    @IsString()
    mimeType?: string = 'audio/wav';

    @ApiProperty({ description: '캔버스 ID' })
    @IsString()
    @IsNotEmpty()
    canvasId: string;

    @ApiProperty({ description: '멘토 인덱스' })
    @IsNumber()
    mentorIdx: number;

    @ApiProperty({ description: '멘티 인덱스' })
    @IsNumber()
    menteeIdx: number;

    @ApiProperty({ description: '오디오 지속 시간', required: false })
    @IsOptional()
    @IsNumber()
    duration?: number;

    @ApiProperty({ description: '청크 인덱스' })
    @IsNumber()
    chunkIndex: number;

    @ApiProperty({ description: '전체 청크 수' })
    @IsNumber()
    totalChunks: number;

    @ApiProperty({ description: '최종 청크 여부', required: false, default: false })
    @IsOptional()
    @IsBoolean()
    isFinalChunk?: boolean = false;

    @ApiProperty({ description: '새 녹화 세션 여부', required: false, default: false })
    @IsOptional()
    @IsBoolean()
    isNewRecordingSession?: boolean = false;

    @ApiProperty({ description: 'URL', required: false })
    @IsOptional()
    @IsString()
    url?: string;

    @ApiProperty({ description: 'pynote 화자분리 여부', required: false, default: false })
    @IsOptional()
    @IsBoolean()
    usePynoteDiarization?: boolean;
}

export class TranscribeRequestDto {
    @ApiProperty({ description: 'Base64 인코딩된 오디오 데이터' })
    @IsString()
    @IsNotEmpty()
    audioData: string;

    @ApiProperty({ description: '오디오 MIME 타입', required: false, default: 'audio/wav`' })
    @IsOptional()
    @IsString()
    mimeType?: string = 'audio/wav';

    @ApiProperty({ description: '캔버스 ID' })
    @IsString()
    @IsNotEmpty()
    canvasId: string;

    @ApiProperty({ description: '멘토 인덱스' })
    @IsNumber()
    mentorIdx: number;

    @ApiProperty({ description: '멘티 인덱스' })
    @IsNumber()
    menteeIdx: number;

    @ApiProperty({ description: '오디오 지속 시간', required: false })
    @IsOptional()
    @IsNumber()
    duration?: number;

    @ApiProperty({ description: '청크 인덱스' })
    @IsNumber()
    chunkIndex: number;

    @ApiProperty({ description: '전체 청크 수' })
    @IsNumber()
    totalChunks: number;

    @ApiProperty({ description: '최종 청크 여부', required: false, default: false })
    @IsOptional()
    @IsBoolean()
    isFinalChunk?: boolean = false;

    @ApiProperty({ description: '새 녹화 세션 여부', required: false, default: false })
    @IsOptional()
    @IsBoolean()
    isNewRecordingSession?: boolean = false;

    @ApiProperty({ description: 'URL', required: false })
    @IsOptional()
    @IsString()
    url?: string;
}
