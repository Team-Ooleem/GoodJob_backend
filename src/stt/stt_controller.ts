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
import { uploadFileToS3, generateS3Key } from '../lib/s3';

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

interface S3UploadResult {
    success: boolean;
    key?: string;
    url?: string;
    error?: string;
}

@Controller('stt')
export class STTController {
    private readonly logger = new Logger(STTController.name);

    constructor(private readonly sttService: STTService) {}

    /**
     * 서버 연결 및 STT API 상태를 확인합니다
     * @returns STT API 연결 상태 정보
     */
    @Get('test')
    async testConnection(): Promise<ConnectionTestResponse> {
        this.logger.log('🔍 STT API 연결 상태 확인 요청');

        const result = await this.sttService.testConnection();

        this.logger.log(`📡 STT API 상태: ${result.status}`);
        this.logConnectionStatus(result);

        return result;
    }

    /**
     * 실시간 음성 파일을 텍스트로 변환합니다 (FormData 업로드 방식)
     * @param audioFile - 업로드된 오디오 파일
     * @returns STT 변환 결과와 처리 정보
     */
    @Post('transcribe')
    @UseInterceptors(FileInterceptor('audio'))
    async transcribeAudio(@UploadedFile() audioFile: Express.Multer.File): Promise<STTResponse> {
        if (!audioFile) {
            throw new BadRequestException('오디오 파일이 없습니다.');
        }

        this.validateAudioFile(audioFile);

        this.logger.log('🎵 새로운 음성 파일 수신');
        this.logFileInfo(audioFile);

        try {
            const startTime = Date.now();

            // STT 변환 실행
            const result = await this.sttService.transcribeAudioBuffer(
                audioFile.buffer,
                audioFile.mimetype,
            );

            // S3에 음성 파일 업로드 (병렬 처리는 하지 않고 순차적으로)
            const s3Result: S3UploadResult | null = await uploadFileToS3(
                audioFile.buffer,
                generateS3Key(audioFile.originalname || 'voice_recording', 'stt_test'),
                audioFile.mimetype,
            ).catch((s3Error) => {
                this.logger.warn('S3 업로드 실패:', s3Error);
                // S3 실패는 전체 처리를 중단하지 않음
                return null;
            });

            const endTime = Date.now();
            const processingTime = endTime - startTime;

            this.logTranscriptionResult(
                result,
                processingTime,
                s3Result?.success ? s3Result.key : undefined,
            );

            return {
                success: true,
                timestamp: new Date().toISOString(),
                processingTime,
                result,
            };
        } catch (error) {
            this.logTranscriptionError(error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error('STT 변환 실패:', error);

            if (error instanceof BadRequestException) {
                throw error;
            }
            throw new InternalServerErrorException(`STT 변환 실패: ${errorMessage}`);
        }
    }

    /**
     * Base64 인코딩된 음성 데이터를 텍스트로 변환합니다
     * @param body - Base64 오디오 데이터와 MIME 타입
     * @returns STT 변환 결과와 처리 정보
     */
    @Post('transcribe-base64')
    async transcribeBase64(@Body() body: TranscribeBase64Request): Promise<STTResponse> {
        const { audioData, mimeType = 'audio/webm' } = body;

        if (!audioData) {
            throw new BadRequestException('오디오 데이터가 없습니다.');
        }

        if (!this.isValidBase64(audioData)) {
            throw new BadRequestException('유효하지 않은 Base64 데이터입니다.');
        }

        this.logger.log('🎵 Base64 음성 데이터 수신');
        this.logBase64Info(mimeType, audioData.length);

        try {
            const startTime = Date.now();

            const result = await this.sttService.transcribeBase64Audio(audioData, mimeType);

            const endTime = Date.now();
            const processingTime = endTime - startTime;

            this.logBase64TranscriptionResult(result, processingTime);

            return {
                success: true,
                timestamp: new Date().toISOString(),
                processingTime,
                result,
            };
        } catch (error) {
            this.logTranscriptionError(error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error('STT 변환 실패:', error);

            if (error instanceof BadRequestException) {
                throw error;
            }
            throw new InternalServerErrorException(`STT 변환 실패: ${errorMessage}`);
        }
    }

    /**
     * 샘플 STT 결과를 반환합니다 (테스트용)
     * @returns 샘플 STT 결과
     */
    @Get('sample')
    getSample(): SampleResponse {
        console.log('='.repeat(60));
        console.log('🧪 샘플 STT 결과 테스트');

        const sample = this.sttService.createSampleResult();

        console.log(`🗣️  샘플 텍스트: "${sample.transcript}"`);
        console.log(`🎯 샘플 신뢰도: ${(sample.confidence * 100).toFixed(1)}%`);
        console.log('📝 샘플 단어 정보:');
        sample.words?.forEach((word, index) => {
            console.log(`   ${index + 1}. "${word.word}" (${word.startTime}s - ${word.endTime}s)`);
        });
        console.log('='.repeat(60));
        console.log('');

        return {
            success: true,
            message: '샘플 STT 결과',
            result: sample,
        };
    }

    /**
     * 업로드된 오디오 파일의 유효성을 검사합니다
     * @param audioFile - 업로드된 오디오 파일
     * @throws BadRequestException 유효하지 않은 파일인 경우
     */
    private validateAudioFile(audioFile: Express.Multer.File): void {
        const maxSize = 10 * 1024 * 1024; // 10MB
        const allowedTypes = ['audio/wav', 'audio/mp3', 'audio/webm', 'audio/flac', 'audio/mpeg'];

        if (audioFile.size > maxSize) {
            throw new BadRequestException('파일 크기는 10MB를 초과할 수 없습니다.');
        }

        if (!allowedTypes.includes(audioFile.mimetype)) {
            throw new BadRequestException(
                `지원되지 않는 파일 형식입니다. 지원 형식: ${allowedTypes.join(', ')}`,
            );
        }

        if (audioFile.size === 0) {
            throw new BadRequestException('빈 파일입니다.');
        }
    }

    /**
     * Base64 문자열의 유효성을 검사합니다
     * @param base64String - 검사할 Base64 문자열
     * @returns 유효한 Base64인지 여부
     */
    private isValidBase64(base64String: string): boolean {
        try {
            // Base64 패턴 확인
            const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;
            if (!base64Pattern.test(base64String)) {
                return false;
            }

            // 길이 확인 (Base64는 4의 배수여야 함)
            if (base64String.length % 4 !== 0) {
                return false;
            }

            // 실제 디코딩 시도
            Buffer.from(base64String, 'base64');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 연결 상태를 콘솔에 로그로 출력합니다
     * @param result - 연결 테스트 결과
     */
    private logConnectionStatus(result: ConnectionTestResponse): void {
        console.log('='.repeat(50));
        console.log('🎤 STT 서버 상태 체크');
        console.log(`상태: ${result.status}`);
        console.log(`메시지: ${result.message}`);
        console.log('='.repeat(50));
    }

    /**
     * 업로드된 파일 정보를 콘솔에 로그로 출력합니다
     * @param audioFile - 업로드된 오디오 파일
     */
    private logFileInfo(audioFile: Express.Multer.File): void {
        console.log('='.repeat(60));
        console.log('🎤 실시간 음성 변환 시작');
        console.log(`📁 파일명: ${audioFile.originalname || 'voice_recording'}`);
        console.log(`📊 파일 크기: ${(audioFile.size / 1024).toFixed(2)} KB`);
        console.log(`🎵 MIME 타입: ${audioFile.mimetype}`);
        console.log('⏳ STT 변환 중...');
    }

    /**
     * Base64 데이터 정보를 콘솔에 로그로 출력합니다
     * @param mimeType - MIME 타입
     * @param dataLength - 데이터 길이
     */
    private logBase64Info(mimeType: string, dataLength: number): void {
        console.log('='.repeat(60));
        console.log('🎤 Base64 음성 변환 시작');
        console.log(`🎵 MIME 타입: ${mimeType}`);
        console.log(`📊 데이터 크기: ${(dataLength / 1024).toFixed(2)} KB`);
        console.log('⏳ STT 변환 중...');
    }

    /**
     * STT 변환 결과를 콘솔에 로그로 출력합니다
     * @param result - STT 변환 결과
     * @param processingTime - 처리 시간 (밀리초)
     * @param s3Key - S3 업로드 키 (선택적)
     */
    private logTranscriptionResult(
        result: STTResult,
        processingTime: number,
        s3Key?: string,
    ): void {
        console.log('✅ STT 변환 완료!');
        console.log(`🗣️  변환된 텍스트: "${result.transcript}"`);
        console.log(`🎯 신뢰도: ${(result.confidence * 100).toFixed(1)}%`);
        console.log(`⏱️  처리 시간: ${processingTime}ms`);

        if (s3Key) {
            console.log(`☁️  S3 업로드 완료: ${s3Key}`);
        }

        this.logWordTimestamps(result.words);
        console.log('='.repeat(60));
        console.log('');
    }

    /**
     * Base64 STT 변환 결과를 콘솔에 로그로 출력합니다
     * @param result - STT 변환 결과
     * @param processingTime - 처리 시간 (밀리초)
     */
    private logBase64TranscriptionResult(result: STTResult, processingTime: number): void {
        console.log('✅ STT 변환 완료!');
        console.log(`🗣️  변환된 텍스트: "${result.transcript}"`);
        console.log(`🎯 신뢰도: ${(result.confidence * 100).toFixed(1)}%`);
        console.log(`⏱️  처리 시간: ${processingTime}ms`);

        this.logWordTimestamps(result.words);
        console.log('='.repeat(60));
        console.log('');
    }

    /**
     * 단어별 타임스탬프 정보를 콘솔에 로그로 출력합니다
     * @param words - 단어별 타임스탬프 배열 (선택적)
     */
    private logWordTimestamps(
        words?: Array<{
            word: string;
            startTime: number;
            endTime: number;
        }>,
    ): void {
        if (words && words.length > 0) {
            console.log('📝 단어별 타임스탬프:');
            words.forEach((word, index) => {
                console.log(
                    `   ${index + 1}. "${word.word}" (${word.startTime.toFixed(
                        1,
                    )}s - ${word.endTime.toFixed(1)}s)`,
                );
            });
        }
    }

    /**
     * STT 변환 오류를 콘솔에 로그로 출력합니다
     * @param error - 발생한 오류
     */
    private logTranscriptionError(error: unknown): void {
        console.log('❌ STT 변환 실패');
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`💥 오류: ${errorMessage}`);
        console.log('='.repeat(60));
        console.log('');
    }
}
