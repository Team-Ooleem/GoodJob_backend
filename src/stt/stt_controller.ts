// stt.controller.ts
import {
    Controller,
    Get,
    Post,
    Body,
    UseInterceptors,
    UploadedFile,
    BadRequestException,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { STTService, STTResult } from './stt_service';
import { uploadFileToS3, fileS3Key } from '../lib/s3';

interface TranscribeBase64Request {
    audioData: string;
    mimeType?: string;
}

interface STTResponse {
    success: boolean;
    timestamp: string;
    processingTime: number;
    result: STTResult;
}

interface SampleResponse {
    success: boolean;
    message: string;
    result: STTResult;
}

interface ConnectionTestResponse {
    status: 'success' | 'error';
    message: string;
}

@Controller('stt')
export class STTController {
    private readonly logger = new Logger(STTController.name);

    constructor(private readonly sttService: STTService) {}

    @Get('test')
    async testConnection(): Promise<ConnectionTestResponse> {
        this.logger.log('STT API 연결 상태 확인 요청');

        const result = await this.sttService.testConnection();
        this.logger.log(`STT API 상태: ${result.status} - ${result.message}`);

        return result;
    }

    @Post('transcribe')
    @UseInterceptors(FileInterceptor('audio'))
    async transcribeAudio(@UploadedFile() audioFile: Express.Multer.File): Promise<STTResponse> {
        if (!audioFile) throw new BadRequestException('오디오 파일이 없습니다.');

        this.validateAudioFile(audioFile);

        this.logger.log(
            `새로운 음성 파일 수신: ${audioFile.originalname} (${audioFile.size} bytes)`,
        );

        try {
            const startTime = Date.now();
            const result = await this.sttService.transcribeAudioBuffer(
                audioFile.buffer,
                audioFile.mimetype,
            );

            const s3Key = fileS3Key(
                audioFile.originalname || 'voice_recording',
                'stt_test',
                audioFile.mimetype,
            );
            const s3Result = await uploadFileToS3(audioFile.buffer, s3Key, audioFile.mimetype);

            const processingTime = Date.now() - startTime;

            this.logger.log(
                `STT 변환 완료: ${result.transcript} (신뢰도: ${(result.confidence * 100).toFixed(1)}%)`,
            );
            if (s3Result?.success) this.logger.log(`S3 업로드 완료: ${s3Result.key}`);

            return { success: true, timestamp: new Date().toISOString(), processingTime, result };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new InternalServerErrorException(`STT 변환 실패: ${message}`);
        }
    }

    @Post('transcribe-base64')
    async transcribeBase64(@Body() body: TranscribeBase64Request): Promise<STTResponse> {
        const { audioData, mimeType = 'audio/webm' } = body;

        if (!audioData) throw new BadRequestException('오디오 데이터가 없습니다.');
        if (!this.isValidBase64(audioData))
            throw new BadRequestException('유효하지 않은 Base64 데이터입니다.');

        this.logger.log(`Base64 음성 데이터 수신: ${mimeType}, 길이: ${audioData.length} bytes`);

        try {
            const startTime = Date.now();
            const result = await this.sttService.transcribeBase64Audio(audioData, mimeType);
            const processingTime = Date.now() - startTime;

            this.logger.log(
                `STT 변환 완료: ${result.transcript} (신뢰도: ${(result.confidence * 100).toFixed(1)}%)`,
            );

            return { success: true, timestamp: new Date().toISOString(), processingTime, result };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`STT 변환 실패: ${message}`);
            throw new InternalServerErrorException(`STT 변환 실패: ${message}`);
        }
    }

    @Get('sample')
    getSample(): SampleResponse {
        const sample = this.sttService.createSampleResult();
        this.logger.log(
            `샘플 STT 결과 테스트: ${sample.transcript} (신뢰도: ${(sample.confidence * 100).toFixed(1)}%)`,
        );
        sample.words?.forEach((w, i) =>
            this.logger.log(`단어 ${i + 1}: "${w.word}" (${w.startTime}s - ${w.endTime}s)`),
        );

        return { success: true, message: '샘플 STT 결과', result: sample };
    }

    private validateAudioFile(file: Express.Multer.File): void {
        const maxSize = 10 * 1024 * 1024;
        const allowedTypes = ['audio/wav', 'audio/mp3', 'audio/webm', 'audio/flac', 'audio/mpeg'];
        if (file.size > maxSize)
            throw new BadRequestException('파일 크기는 10MB를 초과할 수 없습니다.');
        if (!allowedTypes.includes(file.mimetype))
            throw new BadRequestException(`지원되지 않는 파일 형식: ${file.mimetype}`);
        if (file.size === 0) throw new BadRequestException('빈 파일입니다.');
    }

    private isValidBase64(str: string): boolean {
        try {
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(str) || str.length % 4 !== 0) return false;
            Buffer.from(str, 'base64');
            return true;
        } catch {
            return false;
        }
    }
}
