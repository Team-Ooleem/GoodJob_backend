import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { CanvasService } from './canvas.service';
import { CreateCanvasDto } from './dto/create-canvas.dto';
import { UploadCanvasDto } from './dto/upload-canvas.dto';

@Controller('coaching-resume')
export class CanvasController {
    constructor(private readonly canvasService: CanvasService) {}

    // @UseGuards(AuthGuard)
    @Post('canvas')
    async createCanvas(@Body() dto: CreateCanvasDto, @Req() req: any) {
        // const userId = req.user.idx; // JWT 가드에서 넣어준 유저 ID
        const userId = 1;
        return this.canvasService.createCanvas(dto, userId);
    }

    // 캔버스에서 전송된 dataURL 이미지를 S3에 업로드
    @Post('canvas/upload')
    async uploadCanvas(@Body() body: UploadCanvasDto) {
        const { dataUrl, fileName } = body;
        const result = await this.canvasService.uploadCanvasImage(dataUrl, fileName);
        return { url: result.url };
    }

    // 캔버스 상세 조회 (멘토/멘티 정보 포함)
    @Get(':canvasId')
    async getCanvasById(@Param('canvasId') canvasId: string, @Req() req: any) {
        const requesterId = req?.user?.idx ?? req?.user_idx;
        return this.canvasService.getCanvasDetail(canvasId, requesterId);
    }
}
