// calibration.controller.ts
import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Req,
    UploadedFile,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CalibrationService } from './calibration.service';
import { AnalysisClient } from '../audio-metrics/audio-metrics.client';
import { VisualAggregateDto } from '../metrics/dto/visual-aggregate.dto';

@Controller('calibration')
export class CalibrationController {
    constructor(
        private readonly calibrationSvc: CalibrationService,
        private readonly audioClient: AnalysisClient,
    ) {}

    /**
     * 세션별 통합 캘리브레이션 (현재 프론트엔드 setting/page.tsx와 호환)
     */
    @Post(':sessionId/combined')
    @UseInterceptors(FileInterceptor('file'))
    async calibrateSession(
        @Param('sessionId') sessionId: string,
        @UploadedFile() file: Express.Multer.File,
        @Body('visualData') visualDataRaw: any,
        @Body('durationMs') durationMs: string,
        @Req() req: any,
    ) {
        const userId = Number(req.user_idx ?? req.user?.idx);

        // 음성 분석
        const audioFeatures = file ? await this.audioClient.analyzeAudio(file) : null;

        // 영상 데이터 파싱
        const visualData =
            typeof visualDataRaw === 'string'
                ? (JSON.parse(visualDataRaw) as any as VisualAggregateDto)
                : (visualDataRaw as VisualAggregateDto | undefined);

        // 세션별 캘리브레이션 데이터 저장
        const result = await this.calibrationSvc.saveSessionCalibration(
            sessionId,
            userId,
            audioFeatures as any,
            visualData,
            '나는 핀토스를 부순다.', // 고정 텍스트
            parseInt(durationMs) || 0,
        );

        return {
            ok: true,
            audioFeatures,
            visualData,
            calibration: result,
        };
    }

    /**
     * 세션 캘리브레이션 데이터 조회
     */
    @Get(':sessionId')
    async getSessionCalibration(@Param('sessionId') sessionId: string) {
        const calibration = await this.calibrationSvc.getSessionCalibration(sessionId);

        return {
            ok: true,
            calibration,
            hasAudioBaseline: !!calibration?.audioBaseline,
            hasVisualBaseline: !!calibration?.visualBaseline,
        };
    }

    /**
     * 세션 기반 음성 정규화 테스트
     */
    @Post(':sessionId/test/audio-normalize')
    @UseInterceptors(FileInterceptor('file'))
    async testSessionAudioNormalization(
        @Param('sessionId') sessionId: string,
        @UploadedFile() file: Express.Multer.File,
    ) {
        const audioFeatures = await this.audioClient.analyzeAudio(file);
        const normalizationResult = await this.calibrationSvc.normalizeAudioFeatures(
            sessionId,
            audioFeatures as any,
        );

        return {
            ok: true,
            result: normalizationResult,
        };
    }

    /**
     * 세션 기반 영상 정규화 테스트
     */
    @Post(':sessionId/test/visual-normalize')
    async testSessionVisualNormalization(
        @Param('sessionId') sessionId: string,
        @Body() visualData: VisualAggregateDto,
    ) {
        const normalizationResult = await this.calibrationSvc.normalizeVisualFeatures(
            sessionId,
            visualData,
        );

        return {
            ok: true,
            result: normalizationResult,
        };
    }

    /**
     * 레거시 호환: 음성만 캘리브레이션
     */
    @Post('audio')
    @UseInterceptors(FileInterceptor('file'))
    async calibrateAudio(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
        // 임시 세션 ID 생성
        const tempSessionId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const userId = Number(req.user_idx ?? req.user?.idx);

        const audioFeatures = await this.audioClient.analyzeAudio(file);

        const result = await this.calibrationSvc.saveSessionCalibration(
            tempSessionId,
            userId,
            audioFeatures as any,
            undefined,
        );

        return {
            ok: true,
            features: audioFeatures,
            calibration: result,
        };
    }
}
