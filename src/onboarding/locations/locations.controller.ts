import { Controller, Get, Param } from '@nestjs/common';
import { LocationsService } from './locations.service';

@Controller('locations')
export class LocationsController {
    constructor(private readonly locationsService: LocationsService) {}

    // 시도 목록
    @Get('sido')
    async getSidoList() {
        const sidoList = await this.locationsService.getSidoList();
        return {
            success: true,
            data: {
                sido: sidoList.map((item) => ({
                    sido_code: item.sido_code,
                    sido_name: item.sido_name,
                })),
            },
        };
    }

    // 특정 시도의 구/군 목록
    @Get('gu/:sidoCode')
    async getGuListBySido(@Param('sidoCode') sidoCode: string) {
        const guList = await this.locationsService.getGuListBySido(sidoCode);
        return {
            success: true,
            data: {
                gu: guList.map((item) => ({
                    gu_code: item.gu_code,
                    gu_name: item.gu_name,
                })),
            },
        };
    }

    // 모든 지역 정보 (시도별 그룹화)
    @Get('all')
    async getAllLocations() {
        const locations = await this.locationsService.getAllLocations();

        // 시도별로 그룹화
        const groupedLocations = locations.reduce((acc, item) => {
            const sidoCode = item.sido_code;
            if (!acc[sidoCode]) {
                acc[sidoCode] = {
                    sido_code: item.sido_code,
                    sido_name: item.sido_name,
                    gu: [],
                };
            }
            if (item.gu_code) {
                acc[sidoCode].gu.push({
                    gu_code: item.gu_code,
                    gu_name: item.gu_name,
                });
            }
            return acc;
        }, {});

        return {
            success: true,
            data: {
                locations: Object.values(groupedLocations),
            },
        };
    }
}
