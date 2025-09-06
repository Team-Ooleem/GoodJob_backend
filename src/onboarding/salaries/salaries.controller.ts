import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { SalariesService } from './salaries.service';

@Controller('salaries')
export class SalariesController {
    constructor(private readonly salariesService: SalariesService) {}

    // 모든 연봉 구간 조회
    @Get()
    async getAllSalaryRanges() {
        const salaryRanges = await this.salariesService.getAllSalaryRanges();
        return {
            success: true,
            data: {
                salary_ranges: salaryRanges.map((range) => ({
                    id: range.idx,
                    min_salary: range.min_salary,
                    display_text: range.display_text,
                })),
            },
        };
    }

    // 특정 연봉 구간 조회
    @Get(':id')
    async getSalaryRangeById(@Param('id', ParseIntPipe) id: number) {
        const salaryRange = await this.salariesService.getSalaryRangeById(id);

        if (!salaryRange) {
            return {
                success: false,
                message: '해당 연봉 구간을 찾을 수 없습니다.',
                data: null,
            };
        }

        return {
            success: true,
            data: {
                salary_range: {
                    id: salaryRange.idx,
                    min_salary: salaryRange.min_salary,
                    display_text: salaryRange.display_text,
                },
            },
        };
    }

    // 최소 연봉 기준 검색
    @Get('search/min')
    async getSalaryRangesByMinSalary(@Query('min') minSalary: number) {
        const salaryRanges = await this.salariesService.getSalaryRangesByMinSalary(minSalary);
        return {
            success: true,
            data: {
                salary_ranges: salaryRanges.map((range) => ({
                    id: range.idx,
                    min_salary: range.min_salary,
                    display_text: range.display_text,
                })),
            },
        };
    }
}
