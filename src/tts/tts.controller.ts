import {
    Controller,
    Post,
    Get,
    Body,
    Res,
    Req,
    Query,
    HttpStatus,
    Logger,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { TTSService } from './tts.service';
import { SynthesizeSpeechDto } from './dto/tts.dto';

@Controller('tts')
export class TTSController {
    private readonly logger = new Logger(TTSController.name);

    constructor(private readonly ttsService: TTSService) {}

    /**
     * 텍스트를 음성으로 변환
     * POST /tts/synthesize
     */
    @Post('synthesize')
    @UsePipes(new ValidationPipe({ transform: true }))
    async synthesizeSpeech(
        @Body() dto: SynthesizeSpeechDto,
        @Res() res: Response,
        @Req() req: Request,
    ) {
        try {
            this.logger.log(`TTS 요청 수신: ${dto.text.substring(0, 100)}...`);

            const allowedOrigins = [
                'http://localhost:3000',
                'https://localhost:3443',
                process.env.FRONTEND_SUCCESS_URL || 'http://localhost:3001',
            ].filter(Boolean); // undefined 값 제거

            const origin = req.headers.origin;
            const allowedOrigin = allowedOrigins.includes(origin || '')
                ? origin
                : allowedOrigins[0];

            const audioBuffer = await this.ttsService.synthesizeSpeech(dto);

            // Content-Type을 오디오 형식에 맞게 설정
            const contentType = this.getContentType(dto.audioEncoding || 'MP3');

            res.set({
                'Content-Type': contentType,
                'Content-Length': audioBuffer.length.toString(),
                'Cache-Control': 'public, max-age=3600', // 1시간 캐시
                'Access-Control-Allow-Origin': allowedOrigin, // CORS 허용 (필요시 수정)
            });

            res.status(HttpStatus.OK).send(audioBuffer);
        } catch (error) {
            this.logger.error('TTS 처리 실패:', error);
            res.status(HttpStatus.BAD_REQUEST).json({
                success: false,
                error: error instanceof Error ? error.message : 'TTS 변환에 실패했습니다.',
            });
        }
    }

    /**
     * 사용 가능한 음성 목록 조회
     * GET /tts/voices?languageCode=ko-KR
     */
    @Get('voices')
    async getVoices(@Query('languageCode') languageCode: string = 'ko-KR') {
        try {
            const voices = await this.ttsService.getAvailableVoices(languageCode);
            return {
                success: true,
                voices,
            };
        } catch (error) {
            this.logger.error('음성 목록 조회 실패:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '음성 목록 조회에 실패했습니다.',
            };
        }
    }

    /**
     * TTS 서비스 상태 확인
     * GET /tts/health
     */
    @Get('health')
    async healthCheck() {
        try {
            const isHealthy = await this.ttsService.healthCheck();
            return {
                success: true,
                status: isHealthy ? 'healthy' : 'unhealthy',
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            this.logger.error('TTS 헬스체크 실패:', error);
            return {
                success: false,
                status: 'error',
                error: error instanceof Error ? error.message : 'TTS 헬스체크에 실패했습니다.',
                timestamp: new Date().toISOString(),
            };
        }
    }

    /**
     * 간단한 테스트용 엔드포인트
     * POST /tts/test
     */
    @Post('test')
    async testTts(@Res() res: Response) {
        try {
            const testDto: SynthesizeSpeechDto = {
                text: '안녕하세요. TTS 테스트입니다.',
                languageCode: 'ko-KR',
                voiceName: 'ko-KR-Chirp3-HD-Charon',
                audioEncoding: 'MP3',
            };

            const audioBuffer = await this.ttsService.synthesizeSpeech(testDto);

            res.set({
                'Content-Type': 'audio/mpeg',
                'Content-Length': audioBuffer.length.toString(),
                'Content-Disposition': 'attachment; filename="test.mp3"',
            });

            res.status(HttpStatus.OK).send(audioBuffer);
        } catch (error) {
            this.logger.error('TTS 테스트 실패:', error);
            res.status(HttpStatus.BAD_REQUEST).json({
                success: false,
                error: error instanceof Error ? error.message : 'TTS 테스트에 실패했습니다.',
            });
        }
    }

    /**
     * 오디오 인코딩에 따른 Content-Type 반환
     */
    private getContentType(audioEncoding: string): string {
        switch (audioEncoding.toUpperCase()) {
            case 'MP4':
                return 'audio/mpeg';
            case 'LINEAR16':
                return 'audio/wav';
            case 'OGG_OPUS':
                return 'audio/ogg';
            default:
                return 'audio/mpeg'; // 기본값
        }
    }
}
