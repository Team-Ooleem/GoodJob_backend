import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { AnalyzeReportDto } from './dto/analyze-report.dto';
import { ReportService } from './report.service';

@Controller('report')
export class ReportController {
    constructor(private readonly svc: ReportService) {}

    @Post(':sessionId/analyze')
    async analyze(@Param('sessionId') sessionId: string, @Body() dto: AnalyzeReportDto) {
        const data = await this.svc.computeAndMaybeSave(sessionId, dto);
        return { success: true, data };
    }

    @Get(':sessionId')
    async get(@Param('sessionId') sessionId: string) {
        const saved = await this.svc.getSavedReport(sessionId);
        if (saved) return { success: true, data: saved };
        // if not saved, try to compute on-the-fly
        const data = await this.svc.computeOnTheFly(sessionId, { qa: [] } as any);
        return { success: true, data };
    }

    // List recent reports (optional externalKey filter for user scoping)
    @Get()
    async list(
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
        @Query('externalKey') externalKey?: string,
    ) {
        const lim = Math.max(1, Math.min(100, parseInt(limit || '20', 10) || 20));
        const off = Math.max(0, parseInt(offset || '0', 10) || 0);
        const rows = await this.svc.listReports(lim, off, externalKey);
        return { success: true, data: rows };
    }

    // List my reports based on authenticated user
    @Get('my')
    async listMy(
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
        @Req() req?: any,
    ) {
        const lim = Math.max(1, Math.min(100, parseInt(limit || '20', 10) || 20));
        const off = Math.max(0, parseInt(offset || '0', 10) || 0);
        const userId = Number(req?.user_idx ?? req?.user?.idx);
        const rows = await this.svc.listReportsByUser(userId, lim, off);
        return { success: true, data: rows };
    }
}
