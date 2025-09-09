import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Logger,
    Post,
    UploadedFile,
    UseInterceptors,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { SpeakSyncDto } from './dto/speak-sync.dto';
import { AvatarService } from './avatar.service';
import { TTSService } from '@/tts/tts.service';
import { AppConfigService } from '@/config/config.service';
import { uploadFileToS3, fileS3Key } from '@/lib/s3';

@Controller('avatar')
export class AvatarController {
    private readonly logger = new Logger(AvatarController.name);

    constructor(
        private readonly avatarService: AvatarService,
        private readonly ttsService: TTSService,
        private readonly config: AppConfigService,
    ) {}

    @Post('register-image')
    @UseInterceptors(FileInterceptor('file'))
    async registerImage(@UploadedFile() file: Express.Multer.File) {
        if (!file) {
            return { success: false, error: 'file is required' };
        }
        try {
            const out = await this.avatarService.registerImage(file);
            return { success: true, avatarId: out.avatar_id, path: out.path };
        } catch (e: any) {
            this.logger.error('register-image failed', e);
            return { success: false, error: e?.message || 'register-image failed' };
        }
    }

    @Post('speak-sync')
    @HttpCode(HttpStatus.OK)
    @UsePipes(new ValidationPipe({ transform: true }))
    async speakSync(@Body() dto: SpeakSyncDto) {
        try {
            // 1) TTS → WAV (LINEAR16). 구글 TTS 사용, 음성/속도 옵션은 추후 확장
            const wavBuffer = await this.ttsService.synthesizeSpeech({
                text: dto.text,
                languageCode: 'ko-KR',
                voiceName: dto.tts?.voiceName || 'ko-KR-Chirp3-HD-Charon',
                audioEncoding: 'LINEAR16',
                speakingRate: dto.tts?.rate ?? 1.0,
            });

            // 2) AI 서버 render-sync 호출
            const render = await this.avatarService.renderSync({
                avatarId: dto.avatarId,
                wavBuffer,
                resolution: dto.resolution || 256,
                stillMode: dto.stillMode ?? true,
                poseScale: 0.2,
                expressionScale: 0.2,
                enhance: dto.enhance ?? false,
            });

            // 3) S3 업로드
            const key = fileS3Key('avatar_clip.mp4', 'video/mp4');
            const put = await uploadFileToS3(render.mp4Buffer, key, 'video/mp4', this.config.aws);
            if (!put?.success) {
                this.logger.error(`S3 upload failed: ${put?.error}`);
                return { success: false, error: 'upload failed', fallback: 'tts' };
            }

            return {
                success: true,
                videoUrl: put.url,
                duration: render.durationSec,
                meta: { resolution: render.resolution, enhance: dto.enhance ?? false },
            };
        } catch (e: any) {
            // 타임아웃 또는 기타 오류 시 폴백 지시
            const msg = e?.code === 'ECONNABORTED' ? 'timeout' : e?.message || 'render failed';
            this.logger.error(`speak-sync failed: ${msg}`);
            return { success: false, error: msg, fallback: 'tts' };
        }
    }
}
