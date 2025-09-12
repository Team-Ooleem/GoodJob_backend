import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AnalyzeReportDto } from './dto/analyze-report.dto';
import { ReportService } from './report.service';

@Controller('report')
export class ReportController {
    constructor(private readonly svc: ReportService) {}

    @Post(':sessionId/analyze')
    async analyze(@Param('sessionId') sessionId: string, @Body() dto: AnalyzeReportDto) {
        const data = await this.svc.computeAndMaybeSave(sessionId, dto.qa);
        return { success: true, data };
    }

    @Get(':sessionId')
    async get(@Param('sessionId') sessionId: string) {
        const saved = await this.svc.getSavedReport(sessionId);
        if (saved) return { success: true, data: saved };
        // if not saved, try to compute on-the-fly with empty QA
        const data = await this.svc.computeOnTheFly(sessionId, []);
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
}
