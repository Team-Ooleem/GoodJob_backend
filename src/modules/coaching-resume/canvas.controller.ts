import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
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

    // @Get(':canvasId/participants')
    // async getCanvasParticipants(@Param('canvasId') canvasId: string) {
    //     const participants = (await this.databaseService.execute(
    //         `
    //     SELECT
    //         cp.user_id,
    //         cp.role,
    //         u.name,
    //         CASE
    //             WHEN EXISTS(SELECT 1 FROM mentor_profiles mp WHERE mp.user_idx = cp.user_id AND mp.is_approved = 1)
    //             THEN 'mentor'
    //             ELSE 'mentee'
    //         END as actual_role
    //     FROM canvas_participant cp
    //     JOIN users u ON cp.user_id = u.idx
    //     WHERE cp.canvas_id = ?
    // `,
    //         [canvasId],
    //     )) as Array<{ user_id: number; role: string; name: string; actual_role: string }>;

    //     return participants;
    // }
}
