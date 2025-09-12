import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Post,
    Req,
    UploadedFile,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ResumeFileService } from './resume-file.service';
import { z } from 'zod';

const UpdateSummaryBodySchema = z.object({
    summary: z.string().min(20),
});

@Controller('resume-files')
export class ResumeFileController {
    constructor(private readonly svc: ResumeFileService) {}

    // Upload PDF resume
    @Post()
    @UseInterceptors(FileInterceptor('file'))
    async upload(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
        if (!file) throw new BadRequestException('file is required');
        const userId = Number(req.user_idx ?? req.user?.idx);
        if (!userId) throw new BadRequestException('unauthorized');
        return this.svc.uploadPdf(file, userId);
    }

    // Parse PDF to text and auto-summarize via OpenAI
    @Post(':id/parse')
    async parse(@Param('id') id: string, @Req() req: any) {
        const userId = Number(req.user_idx ?? req.user?.idx);
        if (!userId) throw new BadRequestException('unauthorized');
        await this.svc.parseAndSummarizeAsync(id, userId);
        return { accepted: true };
    }

    // List my uploaded resume files
    @Get()
    async list(@Req() req: any) {
        const userId = Number(req.user_idx ?? req.user?.idx);
        if (!userId) throw new BadRequestException('unauthorized');
        return this.svc.listMine(userId);
    }

    // Get details (includes summary if present)
    @Get(':id')
    async getOne(@Param('id') id: string, @Req() req: any) {
        const userId = Number(req.user_idx ?? req.user?.idx);
        if (!userId) throw new BadRequestException('unauthorized');
        return this.svc.getMine(id, userId);
    }

    // Set or update summary (front-end may send extracted text summary)
    @Patch(':id/summary')
    async setSummary(@Param('id') id: string, @Body() body: unknown, @Req() req: any) {
        const parsed = UpdateSummaryBodySchema.safeParse(body);
        if (!parsed.success) {
            throw new BadRequestException(parsed.error.flatten());
        }
        const userId = Number(req.user_idx ?? req.user?.idx);
        if (!userId) throw new BadRequestException('unauthorized');
        await this.svc.updateSummary(id, userId, parsed.data.summary);
        return { success: true };
    }
}
