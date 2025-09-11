import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Param,
    Post,
    UploadedFile,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AudioMetricsService } from './audio-metrics.service';
import type { AudioFeatures } from './audio-metrics.service';
import { AnalysisClient } from './audio-metrics.client';

@Controller('audio-metrics')
export class AudioMetricsController {
    constructor(
        private readonly svc: AudioMetricsService,
        private readonly client: AnalysisClient,
    ) {}

    @Post(':sessionId/:questionId')
    async upsert(
        @Param('sessionId') sessionId: string,
        @Param('questionId') questionId: string,
        @Body() body: AudioFeatures,
    ) {
        await this.svc.upsertQuestionMetrics(sessionId, questionId, body);
        return { ok: true };
    }

    @Get(':sessionId/overall')
    async overall(@Param('sessionId') sessionId: string) {
        const overall = await this.svc.getSessionAudioOverall(sessionId);
        return { ok: true, overall };
    }

    @Get(':sessionId')
    async perQuestion(@Param('sessionId') sessionId: string) {
        const rows = await this.svc.getPerQuestion(sessionId);
        return { ok: true, rows };
    }

    @Post(':sessionId/:questionId/analyze')
    @UseInterceptors(FileInterceptor('file'))
    async analyzeUpload(
        @Param('sessionId') sessionId: string,
        @Param('questionId') questionId: string,
        @UploadedFile() file: Express.Multer.File,
    ) {
        if (!file) throw new BadRequestException('file is required');
        const features = await this.client.analyzeAudio(file);
        await this.svc.upsertQuestionMetrics(sessionId, questionId, features as AudioFeatures);
        return { ok: true, features };
    }

    // Calibration: upload audio, call AI server, return features (no DB write by default)
    @Post('calibration/analyze')
    @UseInterceptors(FileInterceptor('file'))
    async analyzeCalibration(@UploadedFile() file: Express.Multer.File) {
        if (!file) throw new BadRequestException('file is required');
        const features = await this.client.analyzeAudio(file);
        return { ok: true, features };
    }
}
