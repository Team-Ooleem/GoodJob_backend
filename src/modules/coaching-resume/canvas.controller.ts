import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { CanvasService } from './canvas.service';
import { CreateCanvasDto } from './dto/create-canvas.dto';

@Controller('coaching-resume/canvas')
export class CanvasController {
    constructor(private readonly canvasService: CanvasService) {}

    // @UseGuards(AuthGuard)
    @Post()
    async createCanvas(@Body() dto: CreateCanvasDto, @Req() req: any) {
        // const userId = req.user.idx; // JWT 가드에서 넣어준 유저 ID
        const userId = 1;
        return this.canvasService.createCanvas(dto, userId);
    }
}
